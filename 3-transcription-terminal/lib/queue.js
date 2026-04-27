const BetterQueue = require('better-queue');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');
const config = require('./config');
const drive = require('./drive');
const { probeDuration, extractThumbnail, hasAudioStream } = require('./thumbnail');
const { transcribeVideo } = require('./transcribe');
const { diarizeAudio } = require('./diarize');
const { assignSpeakersToSegments, mergeSegments } = require('./merge-segments');
const { embedTexts } = require('./embed');
const { categorizeTranscript } = require('./categorize');
const { parseSpeakersFromFilename } = require('./filename-parser');

function setStatus(videoId, status, errorMessage = null) {
  getDb().prepare('UPDATE videos SET status = ?, error_message = ? WHERE id = ?').run(status, errorMessage, videoId);
}

function upsertSpeaker(name, { isUnknown = false } = {}) {
  const db = getDb();
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  let row = db.prepare('SELECT id FROM speakers WHERE normalized_name = ?').get(normalized);
  if (row) return row.id;
  const id = `spk-${uuidv4()}`;
  db.prepare('INSERT INTO speakers (id, name, normalized_name, is_unknown) VALUES (?, ?, ?, ?)').run(id, name, normalized, isUnknown ? 1 : 0);
  return id;
}

async function runPipeline(videoId) {
  const db = getDb();
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
  if (!video) throw new Error(`Video ${videoId} not found`);

  // Always start clean: any prior partial work (segments / vec / speakers /
  // categories) for this video is wiped before we re-run. Safe whether we got
  // here from boot recovery, a Retry button click, or a normal first run.
  clearPartialWork(db, videoId);

  const tmpPath = path.join(os.tmpdir(), `${videoId}.mp4`);
  const audioPath = path.join(os.tmpdir(), `${videoId}.mp3`);

  try {
    // Cached transcript? If yes, skip the expensive download + Whisper steps.
    let whisper = null;
    if (video.raw_whisper_json) {
      try { whisper = JSON.parse(video.raw_whisper_json); } catch { whisper = null; }
    }

    if (!whisper) {
      // 0. Size guard: Drive metadata first. Reject videos > MAX_SIZE_BYTES so a
      // single huge file doesn't OOM the instance and stall the whole queue.
      const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
      try {
        const meta = await drive.getFileMetadata(video.drive_file_id);
        const sizeBytes = parseInt(meta.size || '0', 10);
        if (sizeBytes > MAX_SIZE_BYTES) {
          db.prepare("UPDATE videos SET status = 'oversized', error_message = ? WHERE id = ?")
            .run(`File ${(sizeBytes / 1024 / 1024).toFixed(0)} MB exceeds ${MAX_SIZE_BYTES / 1024 / 1024} MB processing cap`, videoId);
          console.log(`[queue] ${videoId} skipped: ${(sizeBytes / 1024 / 1024).toFixed(0)} MB`);
          return;
        }
      } catch (e) {
        // If metadata fetch fails, proceed and let download attempt itself error.
        console.warn(`[queue] ${videoId} metadata pre-check failed: ${e.message}`);
      }

      // 1. Download
      setStatus(videoId, 'downloading');
      await drive.downloadFile(video.drive_file_id, tmpPath);

      // 2. Metadata + thumbnail
      const duration = probeDuration(tmpPath);
      const thumbRel = `thumbnails/${videoId}.jpg`;
      const thumbAbs = path.join(config.dataDir, thumbRel);
      extractThumbnail(tmpPath, thumbAbs, Math.min(2, duration / 2));
      db.prepare('UPDATE videos SET duration_seconds = ?, thumbnail_path = ? WHERE id = ?').run(duration, thumbRel, videoId);

      // 2b. No-audio guard: many B-roll / teaser clips have no audio track.
      // Per Noa's call, hard-delete them so they don't pollute the library or
      // queue lists. Cascade FKs clean up segments / speakers / categories;
      // we also unlink the thumbnail we just wrote.
      if (!hasAudioStream(tmpPath)) {
        const thumbAbsForDelete = path.join(config.dataDir, thumbRel);
        if (fs.existsSync(thumbAbsForDelete)) try { fs.unlinkSync(thumbAbsForDelete); } catch {}
        clearPartialWork(db, videoId);
        db.prepare('DELETE FROM videos WHERE id = ?').run(videoId);
        console.log(`[queue] ${videoId} deleted: no audio stream`);
        return;
      }

      // 3. Transcribe
      setStatus(videoId, 'transcribing');
      require('child_process').execSync(
        `ffmpeg -loglevel error -i "${tmpPath}" -vn -acodec libmp3lame -ab 64k -ar 16000 "${audioPath}" -y`,
        { stdio: 'ignore', timeout: 20 * 60 * 1000 }
      );
      whisper = await transcribeVideo(tmpPath);
      // Normalize known Whisper mis-hearings before anything else uses the transcript.
      whisper = normalizeWhisper(whisper);
      db.prepare('UPDATE videos SET raw_whisper_json = ? WHERE id = ?').run(JSON.stringify(whisper), videoId);
    } else {
      console.log(`[queue] ${videoId} reusing cached Whisper transcript (resume)`);
    }

    // 3b. Duplicate detection: hash the normalized transcript and reject if a
    // previously-processed video has the same content. Catches re-uploads of
    // the same talk in different aspect ratios.
    const normalizedText = (whisper.text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalizedText.length >= 50) {
      const hash = crypto.createHash('sha256').update(normalizedText).digest('hex');
      const existing = db
        .prepare("SELECT id, title FROM videos WHERE transcript_hash = ? AND id != ? AND status IN ('ready','duplicate') LIMIT 1")
        .get(hash, videoId);
      if (existing) {
        db.prepare('UPDATE videos SET transcript_hash = ?, status = ?, error_message = ? WHERE id = ?')
          .run(hash, 'duplicate', `Duplicate of ${existing.title} (${existing.id})`, videoId);
        console.log(`[queue] ${videoId} rejected as duplicate of ${existing.id}`);
        return;
      }
      db.prepare('UPDATE videos SET transcript_hash = ? WHERE id = ?').run(hash, videoId);
    }

    // 4. Diarize
    setStatus(videoId, 'diarizing');
    let diar = [];
    try {
      diar = await diarizeAudio(audioPath);
    } catch (e) {
      console.warn(`[queue] diarization failed for ${videoId}: ${e.message}. Continuing without speaker labels.`);
    }

    // 5. Merge
    const whisperSegs = (whisper.segments || []).map(s => ({ start: s.start, end: s.end, text: s.text.trim() }));
    const withLabels = assignSpeakersToSegments(whisperSegs, diar);

    const rosterExtra = [];
    const parsed = parseSpeakersFromFilename(video.title || '', rosterExtra);
    // speaker_hint (set at ingest time, e.g. from folder name) overrides
    // filename-derived attribution. Useful for folders like "DB London" where
    // individual filenames don't mention the speaker.
    const hintedSpeakers = video.speaker_hint ? [video.speaker_hint] : parsed.speakers;
    const { speakerMap } = mergeSegments({ segments: withLabels, hintedSpeakers });

    const insertSeg = db.prepare('INSERT INTO segments (video_id, start_seconds, end_seconds, speaker_id, text) VALUES (?, ?, ?, ?, ?)');
    const insertVideoSpeaker = db.prepare('INSERT OR REPLACE INTO video_speakers (video_id, speaker_id, segment_count) VALUES (?, ?, COALESCE((SELECT segment_count FROM video_speakers WHERE video_id=? AND speaker_id=?),0)+1)');

    const labelToSpeakerId = {};
    for (const [label, name] of Object.entries(speakerMap)) {
      labelToSpeakerId[label] = upsertSpeaker(name, { isUnknown: /^Unknown Speaker/.test(name) });
    }
    // Fallback: when no diarization labels exist but we have a single
    // attributed speaker (from speaker_hint or filename), assign every
    // segment to that speaker. Otherwise use a per-video Unknown bucket.
    const fallbackId = (hintedSpeakers.length === 1)
      ? upsertSpeaker(hintedSpeakers[0])
      : upsertSpeaker(`Unknown Speaker (${videoId.slice(0, 6)})`, { isUnknown: true });

    const tx = db.transaction(() => {
      for (const seg of withLabels) {
        const spkId = seg.speaker_label ? labelToSpeakerId[seg.speaker_label] : fallbackId;
        insertSeg.run(videoId, seg.start, seg.end, spkId, seg.text);
        insertVideoSpeaker.run(videoId, spkId, videoId, spkId);
      }
    });
    tx();

    // 6. Embed
    setStatus(videoId, 'embedding');
    const segRows = db.prepare('SELECT id, text FROM segments WHERE video_id = ? ORDER BY id').all(videoId);
    const embeddings = await embedTexts(segRows.map(r => r.text));
    const insertVec = db.prepare('INSERT INTO segments_vec (segment_id, embedding) VALUES (?, ?)');
    const vecTx = db.transaction(() => {
      for (let i = 0; i < segRows.length; i++) {
        insertVec.run(BigInt(segRows[i].id), Buffer.from(new Float32Array(embeddings[i]).buffer));
      }
    });
    vecTx();

    // 6b. Fuzzy duplicate check via mean-pooled video embedding. Catches
    // re-cuts of the same content where the exact transcript hash differs
    // (e.g. trimmed intro, slight wording drift, different aspect ratios).
    const FUZZY_DUP_THRESHOLD = 0.92;
    const dim = embeddings[0]?.length || 1536;
    const meanEmb = new Float32Array(dim);
    for (const e of embeddings) for (let i = 0; i < dim; i++) meanEmb[i] += e[i];
    if (embeddings.length) for (let i = 0; i < dim; i++) meanEmb[i] /= embeddings.length;
    // L2 normalize so dot product == cosine similarity
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += meanEmb[i] * meanEmb[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) meanEmb[i] /= norm;

    const existingEmbs = db
      .prepare("SELECT id, title, video_embedding FROM videos WHERE status = 'ready' AND id != ? AND video_embedding IS NOT NULL")
      .all(videoId);
    let bestSim = 0;
    let bestMatch = null;
    for (const row of existingEmbs) {
      const buf = row.video_embedding;
      if (!buf || buf.length !== dim * 4) continue;
      const other = new Float32Array(buf.buffer, buf.byteOffset, dim);
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += meanEmb[i] * other[i];
      if (dot > bestSim) { bestSim = dot; bestMatch = row; }
    }
    if (bestSim >= FUZZY_DUP_THRESHOLD && bestMatch) {
      console.log(`[queue] ${videoId} fuzzy-duplicate of ${bestMatch.id} (cos=${bestSim.toFixed(3)})`);
      db.prepare('UPDATE videos SET status = ?, error_message = ? WHERE id = ?')
        .run('duplicate', `Same content as ${bestMatch.title} (similarity ${(bestSim * 100).toFixed(0)}%)`, videoId);
      return;
    }
    // Persist the (already-normalized) embedding so future videos can compare.
    db.prepare('UPDATE videos SET video_embedding = ? WHERE id = ?')
      .run(Buffer.from(meanEmb.buffer), videoId);

    // 7. Auto-tag
    setStatus(videoId, 'tagging');
    const officialCats = db.prepare("SELECT id, name, description FROM categories WHERE status IN ('seed','official')").all();
    const proposedCats = db.prepare("SELECT id, name, description FROM categories WHERE status = 'proposed'").all();
    const fullTranscript = whisper.text || segRows.map(r => r.text).join(' ');

    let tagResult;
    try {
      tagResult = await categorizeTranscript({
        transcript: fullTranscript.slice(0, 40000),
        officialCategories: officialCats,
        proposedCategories: proposedCats,
      });
    } catch (e) {
      console.warn(`[queue] categorize failed for ${videoId}: ${e.message}`);
      tagResult = { matched: [], proposed: [] };
    }

    const catByName = new Map(
      db.prepare('SELECT id, name FROM categories').all().map(c => [c.name.toLowerCase(), c.id])
    );
    const rejectedNames = new Set(
      db.prepare("SELECT name FROM rejected_categories WHERE rejected_at > datetime('now','-30 days')").all().map(r => r.name.toLowerCase())
    );

    const linkCat = db.prepare('INSERT OR REPLACE INTO video_categories (video_id, category_id, confidence) VALUES (?, ?, ?)');
    let linkedCount = 0;
    for (const m of tagResult.matched || []) {
      const cid = catByName.get(String(m.name).toLowerCase());
      if (cid) { linkCat.run(videoId, cid, Math.max(0, Math.min(1, m.confidence ?? 0.5))); linkedCount++; }
    }
    for (const p of tagResult.proposed || []) {
      const lname = String(p.name).toLowerCase();
      if (rejectedNames.has(lname)) continue;
      let cid = catByName.get(lname);
      if (!cid) {
        cid = `cat-${uuidv4()}`;
        db.prepare('INSERT INTO categories (id, name, description, status) VALUES (?, ?, ?, ?)').run(cid, p.name, p.description || null, 'proposed');
        catByName.set(lname, cid);
      }
      linkCat.run(videoId, cid, Math.max(0, Math.min(1, p.confidence ?? 0.5)));
      linkedCount++;
    }

    // If Claude couldn't fit the content into any IM8-relevant category, treat
    // the video as unrelated and hard-delete it. Mirrors the silent-video
    // behavior: nothing useless lands in the library.
    if (linkedCount === 0) {
      const thumbAbsForDelete = video.thumbnail_path ? path.join(config.dataDir, video.thumbnail_path) : null;
      if (thumbAbsForDelete && fs.existsSync(thumbAbsForDelete)) try { fs.unlinkSync(thumbAbsForDelete); } catch {}
      clearPartialWork(db, videoId);
      db.prepare('DELETE FROM videos WHERE id = ?').run(videoId);
      console.log(`[queue] ${videoId} deleted: no IM8-relevant categories matched`);
      return;
    }

    // 8. Done
    setStatus(videoId, 'ready');
  } catch (err) {
    console.error(`[queue] video ${videoId} failed:`, err);
    setStatus(videoId, 'failed', err.message);
    throw err;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

// Pacer: keep at most BATCH_SIZE jobs in better-queue at once. Each time a
// pipeline finishes (success or failure), pull the next 'queued' video from DB
// and push it. This prevents the in-memory queue from holding all 722 IDs and
// stops the worker from stampeding through huge videos that OOM the instance.
const BATCH_SIZE = 5;
let inFlight = 0;

function refillBatch() {
  if (inFlight >= BATCH_SIZE) return;
  const slots = BATCH_SIZE - inFlight;
  const next = getDb()
    .prepare("SELECT id FROM videos WHERE status = 'queued' ORDER BY added_at ASC LIMIT ?")
    .all(slots);
  for (const row of next) {
    inFlight++;
    queue.push(row.id);
  }
}

const queue = new BetterQueue(
  async (videoId, cb) => {
    try {
      await runPipeline(videoId);
      cb(null, { ok: true });
    } catch (err) {
      cb(err);
    } finally {
      inFlight = Math.max(0, inFlight - 1);
      // Top up the in-memory queue from DB so we never hold > BATCH_SIZE.
      setImmediate(refillBatch);
    }
  },
  { concurrent: 1, maxRetries: 0 }
);

function enqueue(videoId) {
  // Don't push directly. The video is already 'queued' in DB; let the pacer
  // pull it (and at most BATCH_SIZE - 1 of its peers) into the in-memory
  // worker queue when there is room.
  refillBatch();
}

function getQueueSnapshot() {
  const rows = getDb()
    .prepare("SELECT id, title, status, error_message FROM videos WHERE status IN ('queued','downloading','transcribing','diarizing','embedding','tagging','failed','duplicate','oversized') ORDER BY added_at DESC")
    .all();
  return rows;
}

// Clean any partial side-effects for a video so the pipeline can restart from
// scratch (or from cached Whisper) without UNIQUE-constraint conflicts on
// segments_vec, video_speakers, etc. Keeps raw_whisper_json and thumbnail.
// Whisper consistently mishears "IM8" as "IMA" or "I am eight". Patch both
// in the full text and in segment text so search hits the right tokens.
function normalizeWhisperText(text) {
  if (!text) return text;
  return text
    .replace(/\bI am eight\b/gi, 'IM8')
    .replace(/\bIma\b/g, 'IM8')
    .replace(/\bIMA\b/g, 'IM8')
    .replace(/\bima\b/g, 'IM8');
}

function normalizeWhisper(whisper) {
  if (!whisper) return whisper;
  if (whisper.text) whisper.text = normalizeWhisperText(whisper.text);
  if (Array.isArray(whisper.segments)) {
    for (const s of whisper.segments) {
      if (s.text) s.text = normalizeWhisperText(s.text);
    }
  }
  return whisper;
}

function clearPartialWork(db, videoId) {
  db.prepare('DELETE FROM segments_vec WHERE segment_id IN (SELECT id FROM segments WHERE video_id = ?)').run(videoId);
  db.prepare('DELETE FROM segments WHERE video_id = ?').run(videoId);
  db.prepare('DELETE FROM video_speakers WHERE video_id = ?').run(videoId);
  db.prepare('DELETE FROM video_categories WHERE video_id = ?').run(videoId);
}

// Resume any work interrupted by a server restart. Run this once at boot.
// Anything still in an in-progress status (downloading/transcribing/etc) had
// its in-memory job lost when the process died; clean its partial DB writes,
// reset status to 'queued', and push back into the queue. Cached
// raw_whisper_json is preserved so retries skip Whisper. Videos that are
// 'ready', 'failed', or 'duplicate' are terminal and left alone.
function resumeInterrupted() {
  const db = getDb();
  const interrupted = db
    .prepare("SELECT id FROM videos WHERE status IN ('downloading','transcribing','diarizing','embedding','tagging')")
    .all();
  const cleanTx = db.transaction(() => {
    for (const v of interrupted) clearPartialWork(db, v.id);
    db.prepare(`
      UPDATE videos
         SET status = 'queued', error_message = NULL
       WHERE status IN ('downloading','transcribing','diarizing','embedding','tagging')
    `).run();
  });
  cleanTx();
  const queuedCount = db.prepare("SELECT COUNT(*) AS n FROM videos WHERE status = 'queued'").get().n;
  // Reset pacer counter on boot then ask for an initial fill.
  inFlight = 0;
  refillBatch();
  if (queuedCount) {
    console.log(`[queue] resumed (${queuedCount} queued in DB, ${interrupted.length} were mid-pipeline cleaned, pacer cap=${BATCH_SIZE})`);
  }
}

module.exports = { enqueue, getQueueSnapshot, runPipeline, resumeInterrupted };

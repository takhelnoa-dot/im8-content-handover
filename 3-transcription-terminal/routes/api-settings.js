const express = require('express');
const config = require('../lib/config');

const router = express.Router();

router.get('/api/settings', (req, res) => {
  res.json({
    searchWeightLexical: config.searchWeightLexical,
    searchWeightSemantic: config.searchWeightSemantic,
    apiStatus: {
      openai: !!config.openaiApiKey,
      assemblyai: !!config.assemblyaiApiKey,
      anthropic: !!config.anthropicApiKey,
      drive: !!config.googleServiceAccountJson,
      upload_folder: !!config.uploadDriveFolderId,
    },
  });
});

module.exports = router;

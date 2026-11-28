export const helpLinks = {
  discord: 'https://discord.gg/bdXnjhrSYQ',
  issues: 'https://github.com/matt123p/TinyCADv4/issues',
};

const translatedManualLanguages = new Set([
  'nl',
  'fr',
  'es',
  'de',
  'it',
  'ja',
  'pl',
  'zh-CN',
]);

export function manualLinks(language) {
  // English is published at /v4/ and has no language path segment.
  const prefix = translatedManualLanguages.has(language) ? `${language}/` : '';
  const home = `https://docs.tinycad.net/v4/${prefix}`;
  return {
    home,
    firstDrawing: `${home}Your-first-drawing/`,
    aiAssistant: `${home}AI-Assistant/`,
    simulation: `${home}Simulation/`,
    languageTranslation: `${home}Language-translation/`,
  };
}

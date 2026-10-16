module.exports = {
  process: (source) => ({ code: `module.exports = { __esModule: true, default: ${JSON.stringify(source)} };` }),
};

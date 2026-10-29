// Re-export Kira AI as the active AI provider while maintaining backward compatibility
const kira = require('./kira');

module.exports = {
  ...kira
};

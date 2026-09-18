const { withDangerousMod } = require('expo/config-plugins');
const { applyLocationForegroundNotificationNative } = require('./locationForegroundNotification');

function withLocationForegroundNotification(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      applyLocationForegroundNotificationNative(config.modRequest.projectRoot);
      return config;
    },
  ]);
}

module.exports = withLocationForegroundNotification;

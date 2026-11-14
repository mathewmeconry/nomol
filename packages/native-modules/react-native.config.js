// Lets React Native's autolinking (used by `expo prebuild`) find the Android library.
module.exports = {
  dependency: {
    platforms: { android: {}, ios: null },
  },
};

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/backend/tests/jest.setup.js'],
  testTimeout: 15000,
};

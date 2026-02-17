/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The src/ backend files use TypeScript ESM convention: `import from '../config.js'`
  // Webpack takes '.js' literally and can't find config.ts.
  // extensionAlias tells webpack to also try .ts/.tsx when it sees a .js import.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js':  ['.ts', '.tsx', '.js', '.jsx'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};

module.exports = nextConfig;

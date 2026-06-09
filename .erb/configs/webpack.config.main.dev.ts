import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import baseConfig from './webpack.config.base';

const rootDir = path.join(__dirname, '../../');

const configuration: webpack.Configuration = merge(baseConfig, {
  target: 'electron-main',
  mode: 'development',
  devtool: 'source-map',
  entry: path.join(rootDir, 'src/main/main.ts'),
  output: {
    path: path.join(rootDir, '.erb/dll'),
    filename: 'main.bundle.dev.js',
    library: { type: 'commonjs2' },
  },
  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
      MAIN_SERVER_URL: 'http://localhost:3001',
    }),
  ],
  externals: {
    electron: 'commonjs electron',
    ws: 'commonjs ws',
    path: 'commonjs path',
    http: 'commonjs http',
    fs: 'commonjs fs',
    crypto: 'commonjs crypto',
    os: 'commonjs os',
    net: 'commonjs net',
    tls: 'commonjs tls',
    stream: 'commonjs stream',
    zlib: 'commonjs zlib',
    events: 'commonjs events',
    url: 'commonjs url',
  },
  node: {
    __dirname: false,
    __filename: false,
  },
});

export default configuration;

import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import baseConfig from './webpack.config.base';

const rootDir = path.join(__dirname, '../../');

const configuration: webpack.Configuration = merge(baseConfig, {
  target: 'electron-preload',
  mode: 'development',
  devtool: 'source-map',
  entry: path.join(rootDir, 'src/preload/preload.ts'),
  output: {
    path: path.join(rootDir, '.erb/dll'),
    filename: 'preload.bundle.dev.js',
  },
  plugins: [
    new webpack.EnvironmentPlugin({ NODE_ENV: 'development' }),
  ],
  externals: {
    electron: 'commonjs electron',
  },
  node: {
    __dirname: false,
    __filename: false,
  },
});

export default configuration;

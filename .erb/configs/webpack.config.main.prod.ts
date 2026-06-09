import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import TerserPlugin from 'terser-webpack-plugin';
import baseConfig from './webpack.config.base';

const rootDir = path.join(__dirname, '../../');

const configuration: webpack.Configuration = merge(baseConfig, {
  target: 'electron-main',
  mode: 'production',
  entry: {
    main: path.join(rootDir, 'src/main/main.ts'),
  },
  output: {
    path: path.join(rootDir, 'release/app/dist/main'),
    filename: 'main.js',
    library: { type: 'commonjs2' },
  },
  optimization: {
    minimizer: [
      new TerserPlugin({ parallel: true, terserOptions: { mangle: true } }),
    ],
  },
  plugins: [
    new webpack.EnvironmentPlugin({ NODE_ENV: 'production' }),
  ],
  node: { __dirname: false, __filename: false },
  externals: { electron: 'commonjs electron', ws: 'commonjs ws' },
});

export default configuration;

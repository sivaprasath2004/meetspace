import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import baseConfig from './webpack.config.base';

const rootDir = path.join(__dirname, '../../');

const configuration: webpack.Configuration = merge(baseConfig, {
  target: ['web', 'electron-renderer'],
  mode: 'production',
  devtool: 'source-map',
  entry: path.join(rootDir, 'src/renderer/index.tsx'),
  output: {
    path: path.join(rootDir, 'release/app/dist/renderer'),
    publicPath: './',
    filename: 'renderer.js',
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
    ],
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({ parallel: true }),
      new CssMinimizerPlugin(),
    ],
  },
  plugins: [
    new webpack.EnvironmentPlugin({ NODE_ENV: 'production' }),
    new MiniCssExtractPlugin({ filename: 'style.css' }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      template: path.join(rootDir, 'src/renderer/index.html'),
      minify: { collapseWhitespace: true },
      inject: true,
    }),
  ],
  resolve: {
    fallback: { path: false, fs: false, crypto: false, stream: false },
  },
  externals: { electron: 'commonjs electron' },
});

export default configuration;

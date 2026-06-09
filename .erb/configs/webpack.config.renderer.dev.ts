import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import baseConfig from './webpack.config.base';

const rootDir = path.join(__dirname, '../../');
const PORT = parseInt(String(process.env.PORT || '1212'), 10);

const configuration: webpack.Configuration = merge(baseConfig, {
  // 'web' target fixes: global, process, Buffer shims + no Node built-in externals
  target: 'web',
  mode: 'development',
  devtool: 'inline-source-map',
  entry: path.join(rootDir, 'src/renderer/index.tsx'),
  output: {
    path: path.join(rootDir, '.erb/dll'),
    publicPath: '/',
    filename: 'renderer.dev.js',
    globalObject: 'globalThis',
  },
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    fallback: {
      path: false,
      fs: false,
      crypto: false,
      stream: false,
      buffer: false,
      os: false,
      net: false,
      tls: false,
      http: false,
      https: false,
      zlib: false,
      url: false,
      assert: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new webpack.HotModuleReplacementPlugin(),
    // Shim global/process so JSONP chunk loading works in Electron renderer
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
      'global': 'globalThis',
    }),
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development',
      MAIN_SERVER_URL: 'http://localhost:3001',
    }),
    new webpack.ProvidePlugin({
      process: 'process/browser',
    }),
    new HtmlWebpackPlugin({
      filename: path.join(rootDir, '.erb/dll/index.html'),
      template: path.join(rootDir, 'src/renderer/index.html'),
      minify: false,
      inject: true,
    }),
  ],
  devServer: {
    port: PORT,
    hot: true,
    compress: true,
    headers: { 'Access-Control-Allow-Origin': '*' },
    static: {
      directory: path.join(rootDir, '.erb/dll'),
      publicPath: '/',
    },
    historyApiFallback: true,
  } as any,
});

export default configuration;

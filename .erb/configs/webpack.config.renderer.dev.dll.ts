import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import baseConfig from './webpack.config.base';

const rootDir = path.join(__dirname, '../../');
const dllDir = path.join(rootDir, '.erb/dll');

// Pre-bundle large vendor libs so dev builds stay fast
const configuration: webpack.Configuration = merge(baseConfig, {
  target: ['web', 'electron-renderer'],
  mode: 'development',
  entry: {
    renderer: ['react', 'react-dom', 'react-router-dom'],
  },
  output: {
    path: dllDir,
    filename: '[name].dev.dll.js',
    library: { name: 'renderer', type: 'var' },
  },
  plugins: [
    new webpack.DllPlugin({
      path: path.join(dllDir, '[name].json'),
      name: '[name]',
    }),
  ],
  resolve: {
    fallback: { path: false, fs: false, crypto: false, stream: false },
  },
});

export default configuration;

import path from 'path';
import webpack from 'webpack';
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin';

// Shared resolve + ts-loader rule used by all targets
const configuration: webpack.Configuration = {
  resolve: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    plugins: [new TsconfigPathsPlugin()],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx|js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: { transpileOnly: true },
        },
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|ico)$/i,
        type: 'asset/resource',
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ],
  },
  // No CSS here — each renderer config adds its own CSS loader
  plugins: [
    new webpack.EnvironmentPlugin({ NODE_ENV: 'production' }),
  ],
};

export default configuration;

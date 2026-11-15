import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ffmpegBin = require('ffmpeg-static') || 'ffmpeg';

// ============================================================================
// Video to MP3 Converter - Client-Side with FFmpeg.wasm
// Supports trimming: user selects start/end time, only that portion converts
// ============================================================================

class VideoToMp3Converter {
    constructor() {
        this.ffmpeg = null;
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isLoaded = false;
        this.isConverting = false;
    }

    async loadFFmpeg() {
        if (this.isLoaded) return true;

        try {
            const { FFmpeg } = FFmpegWASM;
            this.ffmpeg = new FFmpeg();

            // Load with progress
            this.ffmpeg.on('log', ({ message }) => {
                // console.log('[FFmpeg]', message);
            });

            this.ffmpeg.on('progress', ({ progress, time }) => {
                const percent = Math.round(progress * 100);
                const progressBar = document.getElementById('videoProgressBar');
                const progressPercent = document.getElementById('videoProgressPercent');
                const progressText = document.getElementById('videoProgressText');

                if (progressBar) progressBar.style.width = percent + '%';
                if (progressPercent) progressPercent.textContent = percent + '%';
                if (progressText && time > 0) {
                    progressText.textContent = `Processing... ${Math.round(time / 1000000)}s`;
                }
            });

            await this.ffmpeg.load();
            this.isLoaded = true;
            console.log('✅ FFmpeg loaded');
            return true;
        } catch (error) {
            console.error('❌ Failed to load FFmpeg:', error);
            throw new Error('Failed to load video converter. Please try again.');
        }
    }

    async loadVideo(file) {
        this.videoFile = file;

        // Get video duration
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
                URL.revokeObjectURL(video.src);
                this.videoDuration = video.duration;
                resolve(video.duration);
            };
            video.onerror = () => reject(new Error('Failed to load video'));
            video.src = URL.createObjectURL(file);
        });
    }

    getTrimTimes() {
        const startSlider = document.getElementById('trimStart');
        const endSlider = document.getElementById('trimEnd');

        const startPercent = parseFloat(startSlider?.value || 0);
        const endPercent = parseFloat(endSlider?.value || 100);

        const startTime = (startPercent / 100) * this.videoDuration;
        const endTime = (endPercent / 100) * this.videoDuration;

        // Ensure minimum 1 second duration
        if (endTime - startTime < 1) {
            return { startTime, endTime: Math.min(startTime + 1, this.videoDuration) };
        }

        return { startTime, endTime };
    }

    async convertToMp3(startTime, endTime) {
        if (!this.isLoaded) await this.loadFFmpeg();
        if (!this.videoFile) throw new Error('No video loaded');

        this.isConverting = true;
        const ffmpeg = this.ffmpeg;

        try {
            const inputFileName = 'input' + this.getFileExtension(this.videoFile.name);
            const outputFileName = 'output.mp3';

            // Write input file to FFmpeg virtual filesystem
            await ffmpeg.writeFile(inputFileName, new Uint8Array(await this.videoFile.arrayBuffer()));

            // Build FFmpeg command
            const args = [];

            // If trimming
            if (startTime > 0 || endTime < this.videoDuration) {
                args.push('-ss', startTime.toString());
                args.push('-t', (endTime - startTime).toString());
            }

            args.push(
                '-i', inputFileName,
                '-vn',           // No video
                '-acodec', 'libmp3lame',  // MP3 codec
                '-ab', '192k',   // Bitrate
                '-ar', '44100',  // Sample rate
                '-ac', '2',      // Stereo
                '-f', 'mp3',     // Format
                outputFileName
            );

            console.log('🎬 FFmpeg command:', args.join(' '));

            // Execute
            await ffmpeg.exec(args);

            // Read output
            const data = await ffmpeg.readFile(outputFileName);
            this.mp3Blob = new Blob([data.buffer], { type: 'audio/mpeg' });

            // Cleanup virtual filesystem
            await ffmpeg.deleteFile(inputFileName);
            await ffmpeg.deleteFile(outputFileName);

            console.log(`✅ MP3 created: ${(this.mp3Blob.size / 1024).toFixed(1)} KB`);
            return this.mp3Blob;

        } catch (error) {
            console.error('❌ Conversion failed:', error);
            throw new Error('Video conversion failed. Please try a different video.');
        } finally {
            this.isConverting = false;
        }
    }

    getFileExtension(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const validExts = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
        return validExts.includes(ext) ? '.' + ext : '.mp4';
    }

    reset() {
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
    }
}

// Singleton instance
const videoConverter = new VideoToMp3Converter();
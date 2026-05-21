// ============================================================================
// Video to MP3 Converter - Client-Side with FFmpeg.wasm v0.11.6
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
            // FFmpeg.wasm v0.11.6 exposes createFFmpeg globally
            const { createFFmpeg } = FFmpegWASM || window;
            
            if (!createFFmpeg) {
                throw new Error('FFmpeg not available. Please check your internet connection.');
            }

            this.ffmpeg = createFFmpeg({
                log: false,
                corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
            });

            // Suppress logs
            this.ffmpeg.setLogger(() => {});

            // Progress handler
            this.ffmpeg.setProgress(({ ratio }) => {
                const percent = Math.round(ratio * 100);
                const progressBar = document.getElementById('videoProgressBar');
                const progressPercent = document.getElementById('videoProgressPercent');
                const progressText = document.getElementById('videoProgressText');

                if (progressBar) progressBar.style.width = percent + '%';
                if (progressPercent) progressPercent.textContent = percent + '%';
                if (progressText) {
                    progressText.textContent = percent < 100 ? 'Converting audio...' : 'Finalizing...';
                }
            });

            await this.ffmpeg.load();
            this.isLoaded = true;
            console.log('✅ FFmpeg loaded successfully');
            return true;

        } catch (error) {
            console.error('❌ Failed to load FFmpeg:', error);
            throw new Error(
                'Video converter failed to load. This may be due to your browser settings. ' +
                'Please try using Chrome, or check that you are not blocking third-party scripts.'
            );
        }
    }

    async loadVideo(file) {
        this.videoFile = file;

        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            
            video.onloadedmetadata = () => {
                URL.revokeObjectURL(video.src);
                this.videoDuration = video.duration;
                resolve(video.duration);
            };
            
            video.onerror = () => {
                URL.revokeObjectURL(video.src);
                reject(new Error('Failed to load video. The file may be corrupted or unsupported.'));
            };
            
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
            const inputName = 'input' + this.getFileExtension(this.videoFile.name);
            const outputName = 'output.mp3';

            // Read file into Uint8Array
            const fileData = await this.readFileAsUint8Array(this.videoFile);
            
            // Write to FFmpeg virtual filesystem
            ffmpeg.FS('writeFile', inputName, fileData);

            // Build FFmpeg command
            const args = [];
            
            // Trim: -ss for start, -to for end (more accurate than -t)
            if (startTime > 0) {
                args.push('-ss', startTime.toFixed(3));
            }
            if (endTime < this.videoDuration) {
                args.push('-to', endTime.toFixed(3));
            }

            // Conversion settings
            args.push(
                '-i', inputName,
                '-vn',               // Drop video stream
                '-acodec', 'libmp3lame',
                '-ab', '192k',
                '-ar', '44100',
                '-ac', '2',
                '-f', 'mp3',
                outputName
            );

            console.log('🎬 Converting with args:', args.join(' '));
            console.log('⏱️ Trim:', startTime.toFixed(1) + 's', '→', endTime.toFixed(1) + 's');

            // Execute
            await ffmpeg.run(...args);

            // Read output
            const outputData = ffmpeg.FS('readFile', outputName);
            this.mp3Blob = new Blob([outputData.buffer], { type: 'audio/mpeg' });

            // Cleanup virtual filesystem
            ffmpeg.FS('unlink', inputName);
            ffmpeg.FS('unlink', outputName);

            console.log(`✅ MP3 ready: ${(this.mp3Blob.size / 1024).toFixed(1)} KB`);
            return this.mp3Blob;

        } catch (error) {
            console.error('❌ Conversion error:', error);
            
            // Cleanup on error
            try { ffmpeg.FS('unlink', inputName); } catch (e) {}
            try { ffmpeg.FS('unlink', outputName); } catch (e) {}
            
            throw new Error('Video conversion failed. Please try a different video format (MP4 works best).');
        } finally {
            this.isConverting = false;
        }
    }

    readFileAsUint8Array(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsArrayBuffer(file);
        });
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
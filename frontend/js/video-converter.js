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
            // Use the single-file version that doesn't need SharedArrayBuffer
            const { createFFmpeg, fetchFile } = FFmpeg;
            this.ffmpeg = createFFmpeg({
                log: false,
                corePath: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
            });

            // Don't show FFmpeg logs in console
            this.ffmpeg.setLogger(() => {});

            // Set progress handler
            this.ffmpeg.setProgress(({ ratio }) => {
                const percent = Math.round(ratio * 100);
                const progressBar = document.getElementById('videoProgressBar');
                const progressPercent = document.getElementById('videoProgressPercent');
                const progressText = document.getElementById('videoProgressText');

                if (progressBar) progressBar.style.width = percent + '%';
                if (progressPercent) progressPercent.textContent = percent + '%';
                if (progressText) {
                    if (percent < 100) {
                        progressText.textContent = 'Converting audio...';
                    } else {
                        progressText.textContent = 'Finalizing...';
                    }
                }
            });

            await this.ffmpeg.load();
            this.isLoaded = true;
            console.log('✅ FFmpeg loaded');
            return true;
        } catch (error) {
            console.error('❌ Failed to load FFmpeg:', error);
            throw new Error('Failed to load video converter. Please try a different browser or use Chrome.');
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
            const fileData = await this.fetchFile(this.videoFile);
            ffmpeg.FS('writeFile', inputFileName, fileData);

            // Build FFmpeg arguments
            const args = [];

            // Trim options
            if (startTime > 0) {
                args.push('-ss', startTime.toFixed(3));
            }
            if (endTime < this.videoDuration) {
                args.push('-to', endTime.toFixed(3));
            }

            args.push(
                '-i', inputFileName,
                '-vn',              // No video stream
                '-acodec', 'libmp3lame',
                '-ab', '192k',      // Audio bitrate
                '-ar', '44100',     // Sample rate
                '-ac', '2',         // Stereo
                '-f', 'mp3',
                outputFileName
            );

            console.log('🎬 FFmpeg args:', args.join(' '));

            // Execute conversion
            await ffmpeg.run(...args);

            // Read the output file
            const outputData = ffmpeg.FS('readFile', outputFileName);
            
            // Create blob from Uint8Array
            this.mp3Blob = new Blob([outputData.buffer], { type: 'audio/mpeg' });

            // Cleanup
            ffmpeg.FS('unlink', inputFileName);
            ffmpeg.FS('unlink', outputFileName);

            console.log(`✅ MP3 created: ${(this.mp3Blob.size / 1024).toFixed(1)} KB`);
            return this.mp3Blob;

        } catch (error) {
            console.error('❌ Conversion failed:', error);
            throw new Error('Video conversion failed. Please try a different video or browser.');
        } finally {
            this.isConverting = false;
        }
    }

    async fetchFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(new Uint8Array(reader.result));
            reader.onerror = reject;
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
// ============================================================================
// Video to MP3 Converter - Client-Side with FFmpeg.wasm
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
            // Try multiple ways to get the FFmpeg constructor
            const FFmpegClass = 
                window.FFmpeg ||           // Some CDNs
                window.FFmpegWASM ||       // Older versions  
                (window.FFmpegWASM && window.FFmpegWASM.FFmpeg) ||
                (window.createFFmpeg ? { createFFmpeg: window.createFFmpeg } : null);

            // Debug: log what's available
            console.log('🔍 Available globals:', Object.keys(window).filter(k => 
                k.toLowerCase().includes('ffmpeg') || k.toLowerCase().includes('create')
            ));

            if (window.createFFmpeg) {
                // Direct global function
                this.ffmpeg = window.createFFmpeg({
                    log: false,
                    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
                });
            } else if (FFmpegClass && FFmpegClass.createFFmpeg) {
                this.ffmpeg = FFmpegClass.createFFmpeg({
                    log: false,
                    corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
                });
            } else {
                throw new Error(
                    'FFmpeg library not loaded. Please refresh the page or try Chrome browser.'
                );
            }

            this.ffmpeg.setLogger(() => {});
            
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
            console.log('✅ FFmpeg loaded');
            return true;

        } catch (error) {
            console.error('❌ FFmpeg load error:', error);
            throw new Error(
                'Video converter failed to load. Please try using Google Chrome.'
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
                reject(new Error('Failed to load video'));
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

            const fileData = await this.readFileAsUint8Array(this.videoFile);
            ffmpeg.FS('writeFile', inputName, fileData);

            const args = [];
            if (startTime > 0) args.push('-ss', startTime.toFixed(3));
            if (endTime < this.videoDuration) args.push('-to', endTime.toFixed(3));
            args.push(
                '-i', inputName,
                '-vn',
                '-acodec', 'libmp3lame',
                '-ab', '192k',
                '-ar', '44100',
                '-ac', '2',
                '-f', 'mp3',
                outputName
            );

            console.log('🎬 FFmpeg:', args.join(' '));
            await ffmpeg.run(...args);

            const outputData = ffmpeg.FS('readFile', outputName);
            this.mp3Blob = new Blob([outputData.buffer], { type: 'audio/mpeg' });

            ffmpeg.FS('unlink', inputName);
            ffmpeg.FS('unlink', outputName);

            console.log(`✅ MP3: ${(this.mp3Blob.size / 1024).toFixed(1)} KB`);
            return this.mp3Blob;

        } catch (error) {
            console.error('❌ Conversion failed:', error);
            try { ffmpeg.FS('unlink', inputName); } catch (e) {}
            try { ffmpeg.FS('unlink', outputName); } catch (e) {}
            throw new Error('Conversion failed. Try MP4 format for best results.');
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
        return ['.mp4', '.mov', '.avi', '.webm', '.mkv'].includes('.' + ext) ? '.' + ext : '.mp4';
    }

    reset() {
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
    }
}

const videoConverter = new VideoToMp3Converter();
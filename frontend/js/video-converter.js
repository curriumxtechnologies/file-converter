// ============================================================================
// Video to MP3 Converter - FFmpeg.wasm v0.9.8
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
            // v0.9.8 - check what's on window
            console.log('🔍 FFmpeg globals:', Object.keys(window).filter(k => k.toLowerCase().includes('ffmpeg') || k === 'createFFmpeg'));
            
            // Try multiple ways to get createFFmpeg
            let createFFmpeg = window.createFFmpeg;
            
            if (!createFFmpeg && window.FFmpeg) {
                createFFmpeg = window.FFmpeg.createFFmpeg;
            }
            
            if (!createFFmpeg) {
                throw new Error('createFFmpeg not found on window');
            }

            this.ffmpeg = createFFmpeg({
                log: false,
                corePath: 'https://unpkg.com/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
            });

            this.ffmpeg.setLogger(() => {});

            this.ffmpeg.setProgress(({ ratio }) => {
                const percent = Math.round(ratio * 100);
                const bar = document.getElementById('videoProgressBar');
                const pct = document.getElementById('videoProgressPercent');
                const txt = document.getElementById('videoProgressText');
                if (bar) bar.style.width = percent + '%';
                if (pct) pct.textContent = percent + '%';
                if (txt) txt.textContent = percent < 100 ? 'Converting...' : 'Done!';
            });

            await this.ffmpeg.load();
            this.isLoaded = true;
            console.log('✅ FFmpeg ready');
            return true;
        } catch (error) {
            console.error('FFmpeg load failed:', error);
            throw new Error('Converter unavailable. Please use Chrome or Edge.');
        }
    }

    async loadVideo(file) {
        this.videoFile = file;
        return new Promise((resolve, reject) => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.onloadedmetadata = () => {
                URL.revokeObjectURL(v.src);
                this.videoDuration = v.duration;
                resolve(v.duration);
            };
            v.onerror = () => reject(new Error('Cannot read video'));
            v.src = URL.createObjectURL(file);
        });
    }

    getTrimTimes() {
        const s = document.getElementById('trimStart');
        const e = document.getElementById('trimEnd');
        const sp = parseFloat(s?.value || 0);
        const ep = parseFloat(e?.value || 100);
        let start = (sp / 100) * this.videoDuration;
        let end = (ep / 100) * this.videoDuration;
        if (end - start < 1) end = Math.min(start + 1, this.videoDuration);
        return { startTime: start, endTime: end };
    }

    async convertToMp3(startTime, endTime) {
        if (!this.isLoaded) await this.loadFFmpeg();
        if (!this.videoFile) throw new Error('No video');
        this.isConverting = true;

        const ff = this.ffmpeg;
        const ext = '.' + (this.videoFile.name.split('.').pop() || 'mp4');
        const inName = 'input' + ext;
        const outName = 'output.mp3';

        try {
            // Read file as Uint8Array
            const buf = await this.videoFile.arrayBuffer();
            ff.FS('writeFile', inName, new Uint8Array(buf));

            const cmd = [];
            if (startTime > 0) cmd.push('-ss', startTime.toFixed(3));
            if (endTime < this.videoDuration) cmd.push('-to', endTime.toFixed(3));
            cmd.push('-i', inName, '-vn', '-acodec', 'libmp3lame', '-ab', '192k', '-ar', '44100', '-ac', '2', outName);

            console.log('🎬', cmd.join(' '));
            await ff.run(...cmd);

            const data = ff.FS('readFile', outName);
            this.mp3Blob = new Blob([data.buffer], { type: 'audio/mpeg' });

            ff.FS('unlink', inName);
            ff.FS('unlink', outName);

            console.log(`✅ MP3: ${(this.mp3Blob.size / 1024).toFixed(0)} KB`);
            return this.mp3Blob;
        } catch (e) {
            try { ff.FS('unlink', inName); } catch (_) {}
            try { ff.FS('unlink', outName); } catch (_) {}
            throw new Error('Conversion failed. Try MP4 format.');
        } finally {
            this.isConverting = false;
        }
    }

    reset() {
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
    }
}

const videoConverter = new VideoToMp3Converter();
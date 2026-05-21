// ============================================================================
// Video to MP3 Converter - FFmpeg.wasm v0.11.6
// ============================================================================

class VideoToMp3Converter {
    constructor() {
        this.ffmpeg = null;
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isLoaded = false;
    }

    async loadFFmpeg() {
        if (this.isLoaded) return;

        try {
            const { createFFmpeg } = FFmpeg;

            this.ffmpeg = createFFmpeg({ log: true });
            await this.ffmpeg.load();
            this.isLoaded = true;
        } catch (error) {
            throw new Error("Converter unavailable. Please use Chrome or Edge.");
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
            v.onerror = () => reject(new Error('Cannot read video file'));
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
        if (!this.videoFile) throw new Error('No video loaded');

        const ff = this.ffmpeg;
        const ext = '.' + (this.videoFile.name.split('.').pop() || 'mp4');
        const inName = 'input' + ext;
        const outName = 'output.mp3';

        try {
            const fileData = new Uint8Array(await this.videoFile.arrayBuffer());
            ff.FS('writeFile', inName, fileData);

            const cmd = ['-i', inName];
            if (startTime > 0) cmd.push('-ss', startTime.toFixed(3));
            if (endTime < this.videoDuration) cmd.push('-to', endTime.toFixed(3));
            cmd.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2', outName);

            await ff.run(...cmd);

            const data = ff.FS('readFile', outName);
            this.mp3Blob = new Blob([data.buffer], { type: 'audio/mpeg' });

            ff.FS('unlink', inName);
            ff.FS('unlink', outName);

            const url = URL.createObjectURL(this.mp3Blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = this.videoFile.name.replace(/\.[^/.]+$/, '') + '.mp3';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            return this.mp3Blob;
        } catch (e) {
            try { ff.FS('unlink', inName); } catch (_) {}
            try { ff.FS('unlink', outName); } catch (_) {}
            throw new Error('Conversion failed. MP4 works best.');
        }
    }

    reset() {
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isLoaded = false;
        this.ffmpeg = null;
    }
}

const videoConverter = new VideoToMp3Converter();
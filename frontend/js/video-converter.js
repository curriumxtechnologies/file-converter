// ============================================================================
// Video to MP3 Converter - FFmpeg.wasm v0.12 (mobile-compatible)
// ============================================================================

let ffmpeg = null;
let isFFmpegLoaded = false;

async function loadFFmpeg() {
  if (isFFmpegLoaded && ffmpeg) return ffmpeg;

  const { FFmpeg } = FFmpegWASM;
  const { toBlobURL } = FFmpegUtil;

  ffmpeg = new FFmpeg();

  // Progress listener
  ffmpeg.on('progress', ({ progress }) => {
    const percent = Math.round(progress * 100);
    const progressBar    = document.getElementById('videoProgressBar');
    const progressPercent = document.getElementById('videoProgressPercent');
    const progressText   = document.getElementById('videoProgressText');

    if (progressBar)     progressBar.style.width     = `${percent}%`;
    if (progressPercent) progressPercent.textContent  = `${percent}%`;
    if (progressText)    progressText.textContent     =
      percent < 100 ? `Converting... ${percent}%` : 'Finalizing...';
  });

  // Load core + wasm as blob URLs (bypasses COEP restrictions on CDN assets)
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  isFFmpegLoaded = true;
  console.log('FFmpeg v0.12 loaded successfully');
  return ffmpeg;
}

// ============================================================================
// Video to MP3 Converter Class
// ============================================================================
class VideoToMp3Converter {
  constructor() {
    this.ffmpeg       = null;
    this.videoFile    = null;
    this.videoDuration = 0;
    this.mp3Blob      = null;
    this.isLoaded     = false;
    this.isConverting = false;
  }

  async loadFFmpeg() {
    if (this.isLoaded && this.ffmpeg) return true;
    try {
      this.ffmpeg   = await loadFFmpeg();
      this.isLoaded = true;
      console.log('Video converter ready');
      return true;
    } catch (error) {
      console.error('FFmpeg load failed:', error);
      throw new Error(error.message || 'Converter unavailable. Please try a modern browser.');
    }
  }

  async loadVideo(file) {
    if (!file) throw new Error('No video file provided');
    this.videoFile = file;

    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      const url = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        this.videoDuration = video.duration;
        console.log(`Video loaded: ${this.videoDuration.toFixed(2)}s, ${(file.size / 1024 / 1024).toFixed(2)} MB`);
        resolve(this.videoDuration);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Cannot read video file. The file may be corrupted or unsupported.'));
      };

      video.src = url;
    });
  }

  getTrimTimes() {
    const startSlider = document.getElementById('trimStart');
    const endSlider   = document.getElementById('trimEnd');

    let startPercent = startSlider ? parseFloat(startSlider.value) : 0;
    let endPercent   = endSlider   ? parseFloat(endSlider.value)   : 100;

    if (isNaN(startPercent)) startPercent = 0;
    if (isNaN(endPercent))   endPercent   = 100;

    if (startPercent >= endPercent) {
      endPercent = Math.min(startPercent + 5, 100);
      if (endSlider) endSlider.value = endPercent;
    }

    let startTime = (startPercent / 100) * this.videoDuration;
    let endTime   = (endPercent   / 100) * this.videoDuration;

    if (endTime - startTime < 1) {
      endTime = Math.min(startTime + 1, this.videoDuration);
    }

    return { startTime, endTime };
  }

  async convertToMp3(startTime, endTime) {
    if (!this.isLoaded)   await this.loadFFmpeg();
    if (!this.videoFile)  throw new Error('No video file loaded');
    if (this.isConverting) throw new Error('Conversion already in progress');

    this.isConverting = true;

    const ff           = this.ffmpeg;
    const { fetchFile } = FFmpegUtil;
    const extension    = this.videoFile.name.split('.').pop()?.toLowerCase() || 'mp4';
    const inputFilename  = `input.${extension}`;
    const outputFilename = 'output.mp3';

    try {
      const progressText = document.getElementById('videoProgressText');
      if (progressText) progressText.textContent = 'Loading video...';

      console.log(`Loading video: ${this.videoFile.name} (${(this.videoFile.size / 1024 / 1024).toFixed(2)} MB)`);

      // Write input file to FFmpeg virtual FS
      await ff.writeFile(inputFilename, await fetchFile(this.videoFile));

      // Build FFmpeg command
      const command = [];

      // Seek before input for fast trimming
      if (startTime > 0.1) {
        command.push('-ss', startTime.toFixed(3));
      }

      command.push('-i', inputFilename);

      const duration = endTime - startTime;
      if (duration < this.videoDuration - 0.1) {
        command.push('-t', duration.toFixed(3));
      }

      command.push(
        '-vn',                    // No video stream
        '-acodec', 'libmp3lame', // MP3 codec
        '-ab',     '192k',       // 192 kbps bitrate
        '-ar',     '44100',      // 44.1 kHz sample rate
        '-ac',     '2',          // Stereo
        outputFilename
      );

      console.log('FFmpeg command:', command.join(' '));
      if (progressText) progressText.textContent = 'Converting to MP3...';

      await ff.exec(command);

      // Read output
      console.log('Reading output file...');
      const outputData = await ff.readFile(outputFilename);
      this.mp3Blob = new Blob([outputData.buffer], { type: 'audio/mpeg' });

      // Clean up virtual FS
      await ff.deleteFile(inputFilename);
      await ff.deleteFile(outputFilename);

      console.log(`Conversion complete: ${(this.mp3Blob.size / 1024).toFixed(0)} KB MP3`);
      return this.mp3Blob;

    } catch (error) {
      console.error('Conversion error:', error);

      try { await ff.deleteFile(inputFilename);  } catch (e) {}
      try { await ff.deleteFile(outputFilename); } catch (e) {}

      let errorMessage = 'Conversion failed. ';
      if (error.message?.includes('timeout')) {
        errorMessage += 'The video is too large or conversion took too long.';
      } else if (error.message?.includes('memory')) {
        errorMessage += 'The video is too large to process in browser memory.';
      } else {
        errorMessage += 'Please try a different video format (MP4 works best).';
      }

      throw new Error(errorMessage);
    } finally {
      this.isConverting = false;
    }
  }

  getMp3Blob() {
    return this.mp3Blob;
  }

  reset() {
    this.videoFile     = null;
    this.videoDuration = 0;
    this.mp3Blob       = null;
    this.isConverting  = false;

    const startSlider    = document.getElementById('trimStart');
    const endSlider      = document.getElementById('trimEnd');
    const progressBar    = document.getElementById('videoProgressBar');
    const progressPercent = document.getElementById('videoProgressPercent');
    const progressText   = document.getElementById('videoProgressText');

    if (startSlider)     startSlider.value            = 0;
    if (endSlider)       endSlider.value              = 100;
    if (progressBar)     progressBar.style.width      = '0%';
    if (progressPercent) progressPercent.textContent  = '0%';
    if (progressText)    progressText.textContent     = '';
  }

  isReady() {
    return this.isLoaded && !this.isConverting;
  }
}

// Global instance
const videoConverter = new VideoToMp3Converter();

if (typeof window !== 'undefined') {
  window.videoConverter       = videoConverter;
  window.VideoToMp3Converter  = VideoToMp3Converter;
  window.loadFFmpeg           = loadFFmpeg;
}

// ============================================================================
// Video Converter Initialization
// ============================================================================
function initVideoConverter() {
  console.log('Initializing video converter...');

  const videoUploadZone    = document.getElementById('videoUploadZone');
  const videoFileInput     = document.getElementById('videoFileInput');
  const videoSection       = document.getElementById('videoSection');
  const videoPreview       = document.getElementById('videoPreview');
  const trimStart          = document.getElementById('trimStart');
  const trimEnd            = document.getElementById('trimEnd');
  const trimStartLabel     = document.getElementById('trimStartLabel');
  const trimEndLabel       = document.getElementById('trimEndLabel');
  const trimDuration       = document.getElementById('trimDuration');
  const resetTrimBtn       = document.getElementById('resetTrimBtn');
  const videoConvertBtn    = document.getElementById('videoConvertBtn');
  const videoClearBtn      = document.getElementById('videoClearBtn');
  const videoProgress      = document.getElementById('videoProgress');
  const videoDownloadReady = document.getElementById('videoDownloadReady');
  const videoDownloadBtn   = document.getElementById('videoDownloadBtn');

  if (!videoUploadZone || !videoFileInput) {
    console.warn('Video converter elements not found, skipping initialization');
    return;
  }

  let currentVideoFile = null;
  let currentDuration  = 0;

  const originalBtnHTML = videoConvertBtn ? videoConvertBtn.innerHTML : 'Convert to MP3';

  // ── Trim label updater ──────────────────────────────────────────────────────
  function updateTrimLabels() {
    if (!trimStart || !trimEnd || !trimStartLabel || !trimEndLabel || !trimDuration) return;

    const startPercent = parseFloat(trimStart.value) || 0;
    const endPercent   = parseFloat(trimEnd.value)   || 100;
    const startTime    = (startPercent / 100) * currentDuration;
    const endTime      = (endPercent   / 100) * currentDuration;

    trimStartLabel.textContent = startTime.toFixed(1) + 's';
    trimEndLabel.textContent   = endTime.toFixed(1)   + 's';
    trimDuration.textContent   = (endTime - startTime).toFixed(1) + 's';

    if (videoPreview && videoPreview.readyState >= 1) {
      videoPreview.currentTime = startTime;
    }
  }

  // ── Upload zone ─────────────────────────────────────────────────────────────
  videoUploadZone.addEventListener('click', () => videoFileInput.click());

  videoFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) loadVideoFile(e.target.files[0]);
    e.target.value = '';
  });

  ['dragover', 'dragleave', 'drop'].forEach(evt => {
    videoUploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragover') {
        videoUploadZone.classList.add('drag-over');
      } else if (evt === 'dragleave') {
        videoUploadZone.classList.remove('drag-over');
      } else if (evt === 'drop') {
        videoUploadZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) loadVideoFile(file);
      }
    });
  });

  // ── Load video file ─────────────────────────────────────────────────────────
  async function loadVideoFile(file) {
    const ext       = file.name.split('.').pop()?.toLowerCase();
    const validExts = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', 'mpg', 'mpeg'];

    if (!validExts.includes(ext)) {
      const msg = 'Please select a video file (MP4, MOV, AVI, WebM, MKV).';
      window.App ? window.App.showError(msg) : alert(msg);
      return;
    }

    if (file.size > 200 * 1024 * 1024) {
      const msg = 'Video must be under 200MB.';
      window.App ? window.App.showError(msg) : alert(msg);
      return;
    }

    currentVideoFile = file;
    const url = URL.createObjectURL(file);

    if (videoPreview)       videoPreview.src          = url;
    if (videoSection)       videoSection.style.display = 'block';
    if (videoProgress)      videoProgress.style.display = 'none';
    if (videoDownloadReady) videoDownloadReady.style.display = 'none';

    if (videoPreview) {
      videoPreview.onloadedmetadata = () => {
        currentDuration = videoPreview.duration;
        if (trimStart) trimStart.value = 0;
        if (trimEnd)   trimEnd.value   = 100;
        updateTrimLabels();
        console.log(`Video loaded: ${currentDuration.toFixed(2)} seconds`);
      };
      videoPreview.scrollIntoView({ behavior: 'smooth' });
    }

    if (window.App?.hideError) window.App.hideError();
    videoConverter.reset();
  }

  // ── Trim sliders ────────────────────────────────────────────────────────────
  if (trimStart) trimStart.addEventListener('input', updateTrimLabels);
  if (trimEnd)   trimEnd.addEventListener('input',   updateTrimLabels);

  if (trimStart && videoPreview) {
    trimStart.addEventListener('change', () => {
      if (videoPreview.readyState >= 1) {
        videoPreview.currentTime = (parseFloat(trimStart.value) / 100) * currentDuration;
      }
    });
  }

  if (trimEnd && videoPreview) {
    trimEnd.addEventListener('change', () => {
      if (videoPreview.readyState >= 1) {
        videoPreview.currentTime = (parseFloat(trimEnd.value) / 100) * currentDuration;
      }
    });
  }

  if (resetTrimBtn) {
    resetTrimBtn.addEventListener('click', () => {
      if (trimStart) trimStart.value = 0;
      if (trimEnd)   trimEnd.value   = 100;
      updateTrimLabels();
      if (videoPreview && videoPreview.readyState >= 1) videoPreview.currentTime = 0;
    });
  }

  // ── Convert button ──────────────────────────────────────────────────────────
  if (videoConvertBtn) {
    videoConvertBtn.addEventListener('click', async () => {
      if (!currentVideoFile) {
        if (window.App) window.App.showError('Please select a video file first.');
        return;
      }

      if (videoConverter.isConverting) {
        if (window.App) window.App.showError('Conversion already in progress. Please wait.');
        return;
      }

      videoConvertBtn.disabled = true;
      videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading converter...';

      if (videoProgress)      videoProgress.style.display      = 'block';
      if (videoDownloadReady) videoDownloadReady.style.display  = 'none';

      const progressBar     = document.getElementById('videoProgressBar');
      const progressPercent = document.getElementById('videoProgressPercent');
      const progressText    = document.getElementById('videoProgressText');

      if (progressBar)     progressBar.style.width     = '0%';
      if (progressPercent) progressPercent.textContent  = '0%';
      if (progressText)    progressText.textContent     = 'Preparing...';

      try {
        videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading...';
        await videoConverter.loadFFmpeg();

        videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading video...';
        await videoConverter.loadVideo(currentVideoFile);

        const { startTime, endTime } = videoConverter.getTrimTimes();
        console.log(`Trimming: ${startTime.toFixed(1)}s to ${endTime.toFixed(1)}s`);

        videoConvertBtn.innerHTML = '<span class="spinner"></span> Converting to MP3...';
        await videoConverter.convertToMp3(startTime, endTime);

        if (videoProgress)      videoProgress.style.display      = 'none';
        if (videoDownloadReady) videoDownloadReady.style.display  = 'block';

        // Auto-download
        const mp3Name = (currentVideoFile?.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
        if (window.App) {
          window.App.downloadBlob(videoConverter.getMp3Blob(), mp3Name);
        } else {
          const url = URL.createObjectURL(videoConverter.getMp3Blob());
          const a   = document.createElement('a');
          a.href     = url;
          a.download = mp3Name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        // Update stats
        if (window.StatsStore) {
          window.StatsStore.increment(1);
          const todayCount = document.getElementById('todayCount');
          if (todayCount) todayCount.textContent = window.StatsStore.getToday();
        }

        // Feedback modal
        if (window.App) setTimeout(() => window.App.showFeedbackModal(), 1500);

        console.log('Conversion completed successfully');

      } catch (error) {
        console.error('Conversion failed:', error);
        if (window.App) {
          window.App.showError(error.message || 'Conversion failed. Please try again with an MP4 file.');
        }
        if (videoProgress) videoProgress.style.display = 'none';
      } finally {
        videoConvertBtn.disabled  = false;
        videoConvertBtn.innerHTML = originalBtnHTML;
      }
    });
  }

  // ── Manual download button ──────────────────────────────────────────────────
  if (videoDownloadBtn) {
    videoDownloadBtn.addEventListener('click', () => {
      const blob = videoConverter.getMp3Blob();
      if (blob && currentVideoFile) {
        const name = currentVideoFile.name.replace(/\.[^.]+$/, '') + '.mp3';
        if (window.App) {
          window.App.downloadBlob(blob, name);
        } else {
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href     = url;
          a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      }
    });
  }

  // ── Clear button ────────────────────────────────────────────────────────────
  if (videoClearBtn) {
    videoClearBtn.addEventListener('click', () => {
      currentVideoFile = null;
      if (videoPreview)       videoPreview.src                  = '';
      if (videoSection)       videoSection.style.display        = 'none';
      if (videoProgress)      videoProgress.style.display       = 'none';
      if (videoDownloadReady) videoDownloadReady.style.display  = 'none';
      videoConverter.reset();
    });
  }

  console.log('Video converter initialized');
}

if (typeof window !== 'undefined') {
  window.initVideoConverter = initVideoConverter;
}
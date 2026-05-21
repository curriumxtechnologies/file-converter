// ============================================================================
// Video to MP3 Converter - FFmpeg.wasm
// ============================================================================

let ffmpeg = null;
let isFFmpegLoaded = false;

// Helper function to load FFmpeg with retry logic
async function loadFFmpeg() {
  if (isFFmpegLoaded && ffmpeg) return ffmpeg;
  
  // Check SharedArrayBuffer support
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error('SharedArrayBuffer not available. Please ensure you are accessing via localhost with proper COOP/COEP headers.');
  }
  
  // Try multiple CDN sources and configurations
  const configs = [
    // FFmpeg 0.10.0 (latest stable)
    {
      corePath: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.10.0'
    },
    {
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.10.0 (jsdelivr)'
    },
    // FFmpeg 0.9.0 (fallback)
    {
      corePath: 'https://unpkg.com/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.9.0'
    },
    {
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.9.0/dist/ffmpeg-core.js',
      useWorker: false,
      version: '0.9.0 (jsdelivr)'
    },
    // Try with worker enabled as last resort
    {
      corePath: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
      useWorker: true,
      version: '0.10.0 (worker)'
    }
  ];
  
  for (const config of configs) {
    try {
      console.log(`Attempting to load FFmpeg from: ${config.corePath} (${config.version})`);
      
      // Get createFFmpeg function
      let createFFmpeg = window.createFFmpeg;
      if (!createFFmpeg && window.FFmpeg) {
        createFFmpeg = window.FFmpeg.createFFmpeg;
      }
      if (!createFFmpeg && window.FFmpeg && typeof window.FFmpeg === 'object') {
        createFFmpeg = window.FFmpeg.default?.createFFmpeg || window.FFmpeg.createFFmpeg;
      }
      
      if (!createFFmpeg) {
        throw new Error('createFFmpeg not found on window');
      }
      
      ffmpeg = createFFmpeg({
        log: true,
        corePath: config.corePath,
        useWorker: config.useWorker
      });
      
      // Set up logging
      ffmpeg.setLogger(({ type, message }) => {
        if (type === 'error') console.error('FFmpeg:', message);
        else if (type === 'info') console.log('FFmpeg:', message);
      });
      
      // Set progress callback
      ffmpeg.setProgress(({ ratio, time }) => {
        const percent = Math.round(ratio * 100);
        const progressBar = document.getElementById('videoProgressBar');
        const progressPercent = document.getElementById('videoProgressPercent');
        const progressText = document.getElementById('videoProgressText');
        
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressText) {
          if (percent < 100) {
            progressText.textContent = `Converting... ${percent}%`;
          } else {
            progressText.textContent = 'Finalizing...';
          }
        }
      });
      
      // Set timeout for loading
      const loadPromise = ffmpeg.load();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('FFmpeg load timeout (30s)')), 30000)
      );
      
      await Promise.race([loadPromise, timeoutPromise]);
      
      isFFmpegLoaded = true;
      console.log(`✅ FFmpeg loaded successfully from: ${config.corePath}`);
      return ffmpeg;
      
    } catch (error) {
      console.warn(`Failed to load from ${config.corePath}:`, error.message);
      ffmpeg = null;
      // Continue to next config
    }
  }
  
  throw new Error('Failed to load FFmpeg from all CDN sources. Please check your internet connection and try again.');
}

// ============================================================================
// Video to MP3 Converter Class
// ============================================================================
class VideoToMp3Converter {
    constructor() {
        this.ffmpeg = null;
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isLoaded = false;
        this.isConverting = false;
        this.progressCallback = null;
    }

    async loadFFmpeg() {
        if (this.isLoaded && this.ffmpeg) return true;

        try {
            this.ffmpeg = await loadFFmpeg();
            this.isLoaded = true;
            console.log('✅ Video converter ready');
            return true;
        } catch (error) {
            console.error('FFmpeg load failed:', error);
            const errorMsg = error.message || 'Converter unavailable. Please ensure you are using localhost with HTTPS or a modern browser.';
            throw new Error(errorMsg);
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
                console.log(`📹 Video loaded: ${this.videoDuration.toFixed(2)}s, ${(file.size / 1024 / 1024).toFixed(2)} MB`);
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
        const endSlider = document.getElementById('trimEnd');
        
        let startPercent = startSlider ? parseFloat(startSlider.value) : 0;
        let endPercent = endSlider ? parseFloat(endSlider.value) : 100;
        
        // Validate values
        if (isNaN(startPercent)) startPercent = 0;
        if (isNaN(endPercent)) endPercent = 100;
        
        // Ensure start < end
        if (startPercent >= endPercent) {
            endPercent = Math.min(startPercent + 5, 100);
            if (endSlider) endSlider.value = endPercent;
        }
        
        let startTime = (startPercent / 100) * this.videoDuration;
        let endTime = (endPercent / 100) * this.videoDuration;
        
        // Ensure minimum duration of 1 second
        if (endTime - startTime < 1) {
            endTime = Math.min(startTime + 1, this.videoDuration);
        }
        
        return { startTime, endTime };
    }

    async convertToMp3(startTime, endTime) {
        if (!this.isLoaded) {
            await this.loadFFmpeg();
        }
        
        if (!this.videoFile) {
            throw new Error('No video file loaded');
        }
        
        if (this.isConverting) {
            throw new Error('Conversion already in progress');
        }
        
        this.isConverting = true;
        
        const ff = this.ffmpeg;
        const extension = this.videoFile.name.split('.').pop()?.toLowerCase() || 'mp4';
        const inputFilename = `input.${extension}`;
        const outputFilename = 'output.mp3';
        
        try {
            // Update progress UI
            const progressText = document.getElementById('videoProgressText');
            if (progressText) progressText.textContent = 'Loading video...';
            
            // Read video file
            console.log(`📥 Loading video: ${this.videoFile.name} (${(this.videoFile.size / 1024 / 1024).toFixed(2)} MB)`);
            const videoData = await this.videoFile.arrayBuffer();
            ff.FS('writeFile', inputFilename, new Uint8Array(videoData));
            
            // Build FFmpeg command
            const command = [];
            
            // Seek to start time (if not at beginning)
            if (startTime > 0.1) {
                command.push('-ss', startTime.toFixed(3));
            }
            
            // Input file
            command.push('-i', inputFilename);
            
            // Duration limit (if not at end)
            const duration = endTime - startTime;
            if (duration < this.videoDuration - 0.1) {
                command.push('-t', duration.toFixed(3));
            }
            
            // Audio encoding options
            command.push(
                '-vn',           // No video
                '-acodec', 'libmp3lame',  // MP3 codec
                '-ab', '192k',   // Bitrate 192 kbps
                '-ar', '44100',  // Sample rate 44.1 kHz
                '-ac', '2',      // Stereo
                outputFilename
            );
            
            console.log('🎬 FFmpeg command:', command.join(' '));
            
            // Update progress text
            if (progressText) progressText.textContent = 'Converting to MP3...';
            
            // Run conversion
            await ff.run(...command);
            
            // Read output file
            console.log('📤 Reading output file...');
            const outputData = ff.FS('readFile', outputFilename);
            this.mp3Blob = new Blob([outputData.buffer], { type: 'audio/mpeg' });
            
            // Clean up
            ff.FS('unlink', inputFilename);
            ff.FS('unlink', outputFilename);
            
            console.log(`✅ Conversion complete: ${(this.mp3Blob.size / 1024).toFixed(0)} KB MP3`);
            return this.mp3Blob;
            
        } catch (error) {
            console.error('Conversion error:', error);
            
            // Clean up files if they exist
            try { ff.FS('unlink', inputFilename); } catch(e) {}
            try { ff.FS('unlink', outputFilename); } catch(e) {}
            
            // Provide user-friendly error message
            let errorMessage = 'Conversion failed. ';
            if (error.message.includes('timeout')) {
                errorMessage += 'The video is too large or conversion took too long.';
            } else if (error.message.includes('memory')) {
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
        this.videoFile = null;
        this.videoDuration = 0;
        this.mp3Blob = null;
        this.isConverting = false;
        
        // Reset UI elements
        const startSlider = document.getElementById('trimStart');
        const endSlider = document.getElementById('trimEnd');
        const progressBar = document.getElementById('videoProgressBar');
        const progressPercent = document.getElementById('videoProgressPercent');
        const progressText = document.getElementById('videoProgressText');
        
        if (startSlider) startSlider.value = 0;
        if (endSlider) endSlider.value = 100;
        if (progressBar) progressBar.style.width = '0%';
        if (progressPercent) progressPercent.textContent = '0%';
        if (progressText) progressText.textContent = '';
    }
    
    isReady() {
        return this.isLoaded && !this.isConverting;
    }
}

// Create global instance
const videoConverter = new VideoToMp3Converter();

// Export for global use
if (typeof window !== 'undefined') {
    window.videoConverter = videoConverter;
    window.VideoToMp3Converter = VideoToMp3Converter;
    window.loadFFmpeg = loadFFmpeg;
}

// ============================================================================
// Video Converter Initialization Function
// ============================================================================
function initVideoConverter() {
    console.log('🎥 Initializing video converter...');
    
    // Get DOM elements with null checks
    const videoUploadZone = document.getElementById('videoUploadZone');
    const videoFileInput = document.getElementById('videoFileInput');
    const videoSection = document.getElementById('videoSection');
    const videoPreview = document.getElementById('videoPreview');
    const trimStart = document.getElementById('trimStart');
    const trimEnd = document.getElementById('trimEnd');
    const trimStartLabel = document.getElementById('trimStartLabel');
    const trimEndLabel = document.getElementById('trimEndLabel');
    const trimDuration = document.getElementById('trimDuration');
    const resetTrimBtn = document.getElementById('resetTrimBtn');
    const videoConvertBtn = document.getElementById('videoConvertBtn');
    const videoClearBtn = document.getElementById('videoClearBtn');
    const videoProgress = document.getElementById('videoProgress');
    const videoDownloadReady = document.getElementById('videoDownloadReady');
    const videoDownloadBtn = document.getElementById('videoDownloadBtn');
    
    // Check if required elements exist
    if (!videoUploadZone || !videoFileInput) {
        console.warn('Video converter elements not found, skipping initialization');
        return;
    }
    
    let currentVideoFile = null;
    let currentDuration = 0;
    
    // Store original button HTML
    const originalBtnHTML = videoConvertBtn ? videoConvertBtn.innerHTML : 'Convert to MP3';
    
    // Helper to update trim labels
    function updateTrimLabels() {
        if (!trimStart || !trimEnd || !trimStartLabel || !trimEndLabel || !trimDuration) return;
        
        const startPercent = parseFloat(trimStart.value) || 0;
        const endPercent = parseFloat(trimEnd.value) || 100;
        const startTime = (startPercent / 100) * currentDuration;
        const endTime = (endPercent / 100) * currentDuration;
        
        trimStartLabel.textContent = startTime.toFixed(1) + 's';
        trimEndLabel.textContent = endTime.toFixed(1) + 's';
        trimDuration.textContent = (endTime - startTime).toFixed(1) + 's';
        
        // Update video preview time if playing
        if (videoPreview && videoPreview.readyState >= 1) {
            videoPreview.currentTime = startTime;
        }
    }
    
    // Upload zone click
    videoUploadZone.addEventListener('click', () => videoFileInput.click());
    
    // File input change
    videoFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            loadVideoFile(e.target.files[0]);
        }
        e.target.value = '';
    });
    
    // Drag and drop
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
    
    // Load video file
    async function loadVideoFile(file) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const validExts = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', 'mpg', 'mpeg'];
        
        if (!validExts.includes(ext)) {
            if (window.App) {
                window.App.showError('Please select a video file (MP4, MOV, AVI, WebM, MKV).');
            } else {
                alert('Please select a video file (MP4, MOV, AVI, WebM, MKV).');
            }
            return;
        }
        
        if (file.size > 200 * 1024 * 1024) {
            if (window.App) {
                window.App.showError('Video must be under 200MB.');
            } else {
                alert('Video must be under 200MB.');
            }
            return;
        }
        
        currentVideoFile = file;
        const url = URL.createObjectURL(file);
        
        if (videoPreview) {
            videoPreview.src = url;
        }
        
        if (videoSection) {
            videoSection.style.display = 'block';
        }
        
        if (videoProgress) {
            videoProgress.style.display = 'none';
        }
        
        if (videoDownloadReady) {
            videoDownloadReady.style.display = 'none';
        }
        
        if (videoPreview) {
            videoPreview.onloadedmetadata = () => {
                currentDuration = videoPreview.duration;
                if (trimStart) trimStart.max = 100;
                if (trimEnd) trimEnd.max = 100;
                if (trimEnd) trimEnd.value = 100;
                if (trimStart) trimStart.value = 0;
                updateTrimLabels();
                
                console.log(`📹 Video loaded: ${currentDuration.toFixed(2)} seconds`);
            };
        }
        
        if (videoPreview) {
            videoPreview.scrollIntoView({ behavior: 'smooth' });
        }
        
        if (window.App && window.App.hideError) {
            window.App.hideError();
        }
        
        // Reset converter state
        videoConverter.reset();
    }
    
    // Trim sliders
    if (trimStart) {
        trimStart.addEventListener('input', updateTrimLabels);
    }
    
    if (trimEnd) {
        trimEnd.addEventListener('input', updateTrimLabels);
    }
    
    if (trimStart && videoPreview) {
        trimStart.addEventListener('change', () => {
            if (videoPreview.readyState >= 1) {
                const startPercent = parseFloat(trimStart.value) || 0;
                videoPreview.currentTime = (startPercent / 100) * currentDuration;
            }
        });
    }
    
    if (trimEnd && videoPreview) {
        trimEnd.addEventListener('change', () => {
            if (videoPreview.readyState >= 1) {
                const endPercent = parseFloat(trimEnd.value) || 100;
                videoPreview.currentTime = (endPercent / 100) * currentDuration;
            }
        });
    }
    
    // Reset trim
    if (resetTrimBtn) {
        resetTrimBtn.addEventListener('click', () => {
            if (trimStart) trimStart.value = 0;
            if (trimEnd) trimEnd.value = 100;
            updateTrimLabels();
            if (videoPreview && videoPreview.readyState >= 1) {
                videoPreview.currentTime = 0;
            }
        });
    }
    
    // Convert to MP3
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
            
            if (videoProgress) videoProgress.style.display = 'block';
            if (videoDownloadReady) videoDownloadReady.style.display = 'none';
            
            const progressBar = document.getElementById('videoProgressBar');
            const progressPercent = document.getElementById('videoProgressPercent');
            const progressText = document.getElementById('videoProgressText');
            
            if (progressBar) progressBar.style.width = '0%';
            if (progressPercent) progressPercent.textContent = '0%';
            if (progressText) progressText.textContent = 'Preparing...';
            
            try {
                // Load FFmpeg
                videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading FFmpeg...';
                await videoConverter.loadFFmpeg();
                
                // Load video
                videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading video...';
                await videoConverter.loadVideo(currentVideoFile);
                
                // Get trim times
                const { startTime, endTime } = videoConverter.getTrimTimes();
                console.log(`🎬 Trimming: ${startTime.toFixed(1)}s → ${endTime.toFixed(1)}s (${(endTime - startTime).toFixed(1)}s duration)`);
                
                // Convert
                videoConvertBtn.innerHTML = '<span class="spinner"></span> Converting to MP3...';
                await videoConverter.convertToMp3(startTime, endTime);
                
                // Hide progress, show download
                if (videoProgress) videoProgress.style.display = 'none';
                if (videoDownloadReady) videoDownloadReady.style.display = 'block';
                
                // Auto-download
                const mp3Name = (currentVideoFile?.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
                if (window.App) {
                    window.App.downloadBlob(videoConverter.getMp3Blob(), mp3Name);
                } else {
                    // Fallback download
                    const url = URL.createObjectURL(videoConverter.getMp3Blob());
                    const a = document.createElement('a');
                    a.href = url;
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
                
                // Show feedback modal
                if (window.App) {
                    setTimeout(() => window.App.showFeedbackModal(), 1500);
                }
                
                console.log('✅ Conversion completed successfully');
                
            } catch (error) {
                console.error('Conversion failed:', error);
                if (window.App) {
                    window.App.showError(error.message || 'Conversion failed. Please try again with an MP4 file.');
                }
                if (videoProgress) videoProgress.style.display = 'none';
            } finally {
                videoConvertBtn.disabled = false;
                videoConvertBtn.innerHTML = originalBtnHTML;
            }
        });
    }
    
    // Manual download button (backup)
    if (videoDownloadBtn) {
        videoDownloadBtn.addEventListener('click', () => {
            const blob = videoConverter.getMp3Blob();
            if (blob && currentVideoFile) {
                const name = currentVideoFile.name.replace(/\.[^.]+$/, '') + '.mp3';
                if (window.App) {
                    window.App.downloadBlob(blob, name);
                } else {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }
            }
        });
    }
    
    // Clear / choose different video
    if (videoClearBtn) {
        videoClearBtn.addEventListener('click', () => {
            currentVideoFile = null;
            if (videoPreview) videoPreview.src = '';
            if (videoSection) videoSection.style.display = 'none';
            if (videoProgress) videoProgress.style.display = 'none';
            if (videoDownloadReady) videoDownloadReady.style.display = 'none';
            videoConverter.reset();
        });
    }
    
    console.log('✅ Video converter initialized');
}

// Export for global use
if (typeof window !== 'undefined') {
    window.initVideoConverter = initVideoConverter;
}
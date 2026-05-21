// ============================================================================
// File Converter - Main App
// ============================================================================

const App = {
    // Shared utilities
    formatFileSize(bytes) {
        if (!bytes) return '0 Bytes';
        const u = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // Error handling
    showError(msg) {
        const el = document.getElementById('errorSection');
        document.getElementById('errorMessage').textContent = msg;
        el.style.display = 'block';
        clearTimeout(this._errorTimeout);
        this._errorTimeout = setTimeout(() => this.hideError(), 10000);
    },

    hideError() {
        document.getElementById('errorSection').style.display = 'none';
    },

    // Tabs
    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        const btn = document.querySelector(`[data-tab="${tabName}"]`);
        const content = document.getElementById(`tab-${tabName}`);
        if (btn) btn.classList.add('active');
        if (content) content.classList.add('active');
    },

    // Feedback modals
    showFeedbackModal() {
        const hasShown = localStorage.getItem('fileconv_feedback_shown');
        if (hasShown) return;

        const modal = document.getElementById('feedbackModal');
        const input = modal.querySelector('.modal-input');
        modal.style.display = 'flex';
        setTimeout(() => input?.focus(), 300);
    },

    showThankYouModal() {
        const modal = document.getElementById('thankYouModal');
        modal.style.display = 'flex';
        setTimeout(() => { modal.style.display = 'none'; }, 2500);
    }
};

// ============================================================================
// Initialize
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 File Converter ready');

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => App.switchTab(btn.dataset.tab));
    });

    // Error close
    document.getElementById('errorCloseBtn').addEventListener('click', () => App.hideError());

    // Feedback modal
    const feedbackModal = document.getElementById('feedbackModal');
    const feedbackForm = document.getElementById('feedbackForm');
    const feedbackClose = document.getElementById('feedbackClose');

    feedbackClose.addEventListener('click', () => feedbackModal.style.display = 'none');
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) feedbackModal.style.display = 'none';
    });

    feedbackForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await fetch(feedbackForm.action, {
                method: 'POST',
                body: new FormData(feedbackForm),
                headers: { 'Accept': 'application/json' }
            });
        } catch (err) { /* ignore */ }
        feedbackModal.style.display = 'none';
        feedbackForm.reset();
        localStorage.setItem('fileconv_feedback_shown', 'true');
        App.showThankYouModal();
    });

    // Thank you modal
    const thankYouModal = document.getElementById('thankYouModal');
    thankYouModal.addEventListener('click', (e) => {
        if (e.target === thankYouModal) thankYouModal.style.display = 'none';
    });

    // Init HEIC converter
    const heicState = new AppState();
    new HeicUIManager(heicState);

    // Init Video converter
    initVideoConverter();

    // Update stats
    document.getElementById('todayCount').textContent = StatsStore.getToday();

    // Paste handler
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const files = [];
        for (const item of items) {
            if (item.kind === 'file') files.push(item.getAsFile());
        }
        if (files.length) {
            e.preventDefault();
            const heicFiles = files.filter(f => {
                const ext = f.name.split('.').pop()?.toLowerCase();
                return ext === 'heic' || ext === 'heif';
            });
            if (heicFiles.length) {
                heicFiles.forEach(f => heicState.addFile(f));
                App.switchTab('heic');
            }
        }
    });
});

// ============================================================================
// Video Converter Initialization
// ============================================================================
function initVideoConverter() {
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
    const videoProgressBar = document.getElementById('videoProgressBar');
    const videoProgressPercent = document.getElementById('videoProgressPercent');
    const videoProgressText = document.getElementById('videoProgressText');

    let currentVideoFile = null;
    let currentDuration = 0;

    // Store original button HTML
    const originalBtnHTML = videoConvertBtn.innerHTML;

    // Upload zone click
    videoUploadZone.addEventListener('click', () => videoFileInput.click());

    // File input change
    videoFileInput.addEventListener('change', (e) => {
        if (e.target.files.length) loadVideoFile(e.target.files[0]);
        e.target.value = '';
    });

    // Drag and drop
    ['dragover', 'dragleave', 'drop'].forEach(evt => {
        videoUploadZone.addEventListener(evt, (e) => {
            e.preventDefault();
            if (evt === 'dragover') videoUploadZone.classList.add('drag-over');
            if (evt === 'dragleave') videoUploadZone.classList.remove('drag-over');
            if (evt === 'drop') {
                videoUploadZone.classList.remove('drag-over');
                const file = e.dataTransfer.files[0];
                if (file) loadVideoFile(file);
            }
        });
    });

    // Load video file
    function loadVideoFile(file) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const validExts = ['mp4', 'mov', 'avi', 'webm', 'mkv'];

        if (!validExts.includes(ext)) {
            App.showError('Please select a video file (MP4, MOV, AVI, WebM, MKV).');
            return;
        }

        if (file.size > 200 * 1024 * 1024) {
            App.showError('Video must be under 200MB.');
            return;
        }

        currentVideoFile = file;
        const url = URL.createObjectURL(file);
        videoPreview.src = url;
        videoSection.style.display = 'block';
        videoProgress.style.display = 'none';
        videoDownloadReady.style.display = 'none';

        videoPreview.onloadedmetadata = () => {
            currentDuration = videoPreview.duration;
            trimEnd.max = 100;
            trimEnd.value = 100;
            trimStart.value = 0;
            updateTrimLabels();
        };

        videoPreview.scrollIntoView({ behavior: 'smooth' });
        App.hideError();
    }

    // Trim sliders
    function updateTrimLabels() {
        const start = (parseFloat(trimStart.value) / 100) * currentDuration;
        const end = (parseFloat(trimEnd.value) / 100) * currentDuration;
        trimStartLabel.textContent = start.toFixed(1) + 's';
        trimEndLabel.textContent = end.toFixed(1) + 's';
        trimDuration.textContent = (end - start).toFixed(1) + 's';

        if (parseFloat(trimStart.value) >= parseFloat(trimEnd.value)) {
            trimStart.value = Math.max(0, parseFloat(trimEnd.value) - 1);
        }
    }

    trimStart.addEventListener('input', updateTrimLabels);
    trimEnd.addEventListener('input', updateTrimLabels);

    trimStart.addEventListener('change', () => {
        videoPreview.currentTime = (parseFloat(trimStart.value) / 100) * currentDuration;
    });
    trimEnd.addEventListener('change', () => {
        videoPreview.currentTime = (parseFloat(trimEnd.value) / 100) * currentDuration;
    });

    // Reset trim
    resetTrimBtn.addEventListener('click', () => {
        trimStart.value = 0;
        trimEnd.value = 100;
        updateTrimLabels();
        videoPreview.currentTime = 0;
    });

    // Convert to MP3
    videoConvertBtn.addEventListener('click', async () => {
        if (!currentVideoFile) return;
        if (videoConverter.isConverting) return;

        videoConvertBtn.disabled = true;
        videoConvertBtn.innerHTML = '<span class="spinner"></span> Loading converter...';
        videoProgress.style.display = 'block';
        videoDownloadReady.style.display = 'none';
        videoProgressBar.style.width = '0%';
        videoProgressPercent.textContent = '0%';
        videoProgressText.textContent = 'Preparing...';

        try {
            // Load FFmpeg
            await videoConverter.loadFFmpeg();

            // Load video
            videoConvertBtn.innerHTML = '<span class="spinner"></span> Processing video...';
            await videoConverter.loadVideo(currentVideoFile);

            // Get trim times
            const { startTime, endTime } = videoConverter.getTrimTimes();
            console.log(`🎬 Trimming: ${startTime.toFixed(1)}s → ${endTime.toFixed(1)}s`);

            // Convert
            videoConvertBtn.innerHTML = '<span class="spinner"></span> Converting to MP3...';
            await videoConverter.convertToMp3(startTime, endTime);

            // Hide progress
            videoProgress.style.display = 'none';
            videoDownloadReady.style.display = 'block';

            // ✅ AUTO-DOWNLOAD
            const mp3Name = (currentVideoFile?.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
            App.downloadBlob(videoConverter.mp3Blob, mp3Name);

            // Update stats
            StatsStore.increment(1);
            document.getElementById('todayCount').textContent = StatsStore.getToday();

            // Show feedback modal after a delay
            setTimeout(() => App.showFeedbackModal(), 1500);

        } catch (error) {
            App.showError(error.message || 'Conversion failed. Please try again.');
            videoProgress.style.display = 'none';
        } finally {
            videoConvertBtn.disabled = false;
            videoConvertBtn.innerHTML = originalBtnHTML;
        }
    });

    // Manual download button (backup)
    videoDownloadBtn.addEventListener('click', () => {
        if (videoConverter.mp3Blob) {
            const name = (currentVideoFile?.name || 'audio').replace(/\.[^.]+$/, '') + '.mp3';
            App.downloadBlob(videoConverter.mp3Blob, name);
        }
    });

    // Clear / choose different video
    videoClearBtn.addEventListener('click', () => {
        currentVideoFile = null;
        videoPreview.src = '';
        videoSection.style.display = 'none';
        videoProgress.style.display = 'none';
        videoDownloadReady.style.display = 'none';
        videoConverter.reset();
        trimStart.value = 0;
        trimEnd.value = 100;
    });
}
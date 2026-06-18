const toggle = document.getElementById('enableContextToggle');
const knowledgeToggle = document.getElementById('knowledgeModeToggle');
const hideButtonsToggle = document.getElementById('hideButtonsToggle');
const hideLogsToggle = document.getElementById('hideLogsToggle');
const fileInput = document.getElementById('fileInput');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');
const aiStatusDiv = document.getElementById('aiStatus');
const jsonOutputDiv = document.getElementById('jsonOutput');
const actionButtons = document.getElementById('actionButtons');
const logsArea = document.getElementById('logsArea');

chrome.storage.local.get(['contextEnabled', 'knowledgeModeEnabled', 'hideButtons', 'hideLogs', 'lastAiResponse', 'pdfRead', 'customContextFile'], (result) => {
    const isEnabled = result.contextEnabled === true;
    toggle.checked = isEnabled;
    knowledgeToggle.checked = result.knowledgeModeEnabled === true;
    hideButtonsToggle.checked = result.hideButtons === true;
    hideLogsToggle.checked = result.hideLogs === true;
    
    updateUI(isEnabled);
    updateVisibility();
    
    if (result.customContextFile) {
        statusDiv.innerText = `[GOTOWE] Wgrano: ${result.customContextFile.name}`;
    }
    
    updateAiLogs(result.lastAiResponse, result.pdfRead);
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.lastAiResponse || changes.pdfRead) {
            chrome.storage.local.get(['lastAiResponse', 'pdfRead'], (res) => {
                updateAiLogs(res.lastAiResponse, res.pdfRead);
            });
        }
    }
});

toggle.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ contextEnabled: isEnabled }, () => updateUI(isEnabled));
});

knowledgeToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ knowledgeModeEnabled: e.target.checked });
});

hideButtonsToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ hideButtons: e.target.checked }, updateVisibility);
});

hideLogsToggle.addEventListener('change', (e) => {
    chrome.storage.local.set({ hideLogs: e.target.checked }, updateVisibility);
});

function updateUI(isEnabled) {
    fileInput.disabled = !isEnabled;
    saveBtn.disabled = !isEnabled;
    clearBtn.disabled = !isEnabled;
}

function updateVisibility() {
    actionButtons.classList.toggle('hidden', hideButtonsToggle.checked);
    logsArea.classList.toggle('hidden', hideLogsToggle.checked);
}

function updateAiLogs(jsonString, pdfRead) {
    if (jsonString) {
        jsonOutputDiv.innerText = jsonString;
    }
    if (pdfRead !== undefined) {
        aiStatusDiv.innerText = pdfRead ? "[SUKCES] Model pomyślnie odczytał dane z pliku PDF." : "[INFO] Plik PDF nie został użyty w tej odpowiedzi.";
        aiStatusDiv.style.color = pdfRead ? '#16a34a' : '#64748b';
    }
}

saveBtn.addEventListener('click', () => {
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Data = e.target.result.split(',')[1];
        chrome.storage.local.set({
            customContextFile: {
                mimeType: file.type || 'application/pdf',
                data: base64Data,
                name: file.name
            }
        }, () => {
            statusDiv.innerText = `[GOTOWE] Wgrano: ${file.name}`;
        });
    };
    reader.readAsDataURL(file);
});

clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('customContextFile', () => {
        statusDiv.innerText = "";
        fileInput.value = "";
    });
});
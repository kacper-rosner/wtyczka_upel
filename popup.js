import { API_KEY } from './api.js';

const toggle = document.getElementById('enableContextToggle');
const knowledgeToggle = document.getElementById('knowledgeModeToggle');
const floatingBtnToggle = document.getElementById('floatingBtnToggle');
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

const trainModelSelect = document.getElementById('trainModelSelect');
const trainCountInput = document.getElementById('trainCountInput');
const trainBtn = document.getElementById('trainBtn');
const hideOnPageLogsToggle = document.getElementById('hideOnPageLogsToggle');

chrome.runtime.sendMessage({ action: "getModels" }, (response) => {
    if (response && response.models) {
        response.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.text = model;
            if (model.includes('pro')) option.selected = true;
            trainModelSelect.appendChild(option);
        });
    }
});

chrome.storage.local.get(['contextEnabled', 'knowledgeModeEnabled', 'floatingBtn', 'hideButtons', 'hideLogs', 'lastAiResponse', 'pdfRead', 'customContextFile', 'learnedContext', 'hideOnPageLogs'], (result) => {
    
    hideOnPageLogsToggle.checked = result.hideOnPageLogs === true;
    const isEnabled = result.contextEnabled === true;
    toggle.checked = isEnabled;
    knowledgeToggle.checked = result.knowledgeModeEnabled === true;
    floatingBtnToggle.checked = result.floatingBtn === true;
    hideButtonsToggle.checked = result.hideButtons === true;
    hideLogsToggle.checked = result.hideLogs === true;
    
    updateUI(isEnabled);
    updateVisibility();
    updateFileStatus(result.customContextFile, result.learnedContext);
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

knowledgeToggle.addEventListener('change', (e) => chrome.storage.local.set({ knowledgeModeEnabled: e.target.checked }));
floatingBtnToggle.addEventListener('change', (e) => chrome.storage.local.set({ floatingBtn: e.target.checked }));
hideButtonsToggle.addEventListener('change', (e) => chrome.storage.local.set({ hideButtons: e.target.checked }, updateVisibility));
hideLogsToggle.addEventListener('change', (e) => chrome.storage.local.set({ hideLogs: e.target.checked }, updateVisibility));
hideOnPageLogsToggle.addEventListener('change', (e) => chrome.storage.local.set({ hideOnPageLogs: e.target.checked }));

function updateUI(isEnabled) {
    fileInput.disabled = !isEnabled;
    saveBtn.disabled = !isEnabled;
    clearBtn.disabled = !isEnabled;
}

function updateVisibility() {
    actionButtons.classList.toggle('hidden', hideButtonsToggle.checked);
    logsArea.classList.toggle('hidden', hideLogsToggle.checked);
}

function updateFileStatus(fileObj, learnedCtx) {
    if (!fileObj) {
        statusDiv.innerText = "";
        trainModelSelect.disabled = true;
        trainCountInput.disabled = true;
        trainBtn.disabled = true;
        return;
    }
    
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const timePassed = Date.now() - fileObj.uploadedAt;
    
    if (timePassed > ONE_DAY_MS) {
        statusDiv.innerText = `[WYGASŁ] Plik ${fileObj.name} wygasł po 24h. Wgraj ponownie.`;
        statusDiv.style.color = "#ef4444";
        trainModelSelect.disabled = true;
        trainCountInput.disabled = true;
        trainBtn.disabled = true;
    } else {
        const hoursLeft = Math.round((ONE_DAY_MS - timePassed) / (1000 * 60 * 60));
        statusDiv.innerText = `[GOTOWE] Wgrano: ${fileObj.name} (Zostało ok. ${hoursLeft}h)\n${learnedCtx ? 'Trening wykonany.' : 'Brak treningu.'}`;
        statusDiv.style.color = "#16a34a";
        trainModelSelect.disabled = false;
        trainCountInput.disabled = false;
        trainBtn.disabled = false;
    }
}

function updateAiLogs(jsonString, pdfRead) {
    if (jsonString) jsonOutputDiv.innerText = jsonString;
    if (pdfRead !== undefined) {
        aiStatusDiv.innerText = pdfRead ? "[SUKCES] Model odczytał kontekst." : "[INFO] Kontekst nie został użyty w odpowiedzi.";
        aiStatusDiv.style.color = pdfRead ? '#16a34a' : '#64748b';
    }
}

trainBtn.addEventListener('click', () => {
    const selectedModel = trainModelSelect.value;
    const count = parseInt(trainCountInput.value) || 5;
    
    statusDiv.innerText = "Model trenuje... Opracowuje streszczenie. Proszę czekać.";
    statusDiv.style.color = "#8b5cf6";
    trainBtn.disabled = true;

    chrome.runtime.sendMessage({ action: "trainContext", model: selectedModel, count: count }, (response) => {
        trainBtn.disabled = false;
        if (response && response.error) {
            statusDiv.innerText = "Błąd treningu: " + response.error;
            statusDiv.style.color = "#ef4444";
        } else {
            chrome.storage.local.get(['customContextFile', 'learnedContext'], (res) => {
                updateFileStatus(res.customContextFile, res.learnedContext);
            });
        }
    });
});

saveBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    statusDiv.innerText = "Inicjalizacja przesyłania...";
    statusDiv.style.color = "#64748b";

    if (!API_KEY || API_KEY.trim() === "" || API_KEY.includes("TWÓJ_KLUCZ")) {
        statusDiv.innerText = "BŁĄD KONFIGURACJI: Brak poprawnego klucza API w config.js";
        statusDiv.style.color = "#ef4444";
        return;
    }

    const mimeType = file.type || 'application/pdf';

    try {
        const initResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": file.size.toString(),
                "X-Goog-Upload-Header-Content-Type": mimeType
            },
            body: JSON.stringify({ file: { displayName: file.name } })
        });

        if (!initResponse.ok) {
            const text = await initResponse.text();
            throw new Error(`Inicjalizacja nieudana (${initResponse.status}): ${text}`);
        }

        const uploadUrl = initResponse.headers.get("X-Goog-Upload-URL");
        if (!uploadUrl) throw new Error("Nie otrzymano URL uploadu.");

        statusDiv.innerText = "Wysyłanie pliku...";

        const uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: {
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize"
            },
            body: file
        });

        const responseText = await uploadResponse.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (jsonErr) {
            throw new Error("Serwer nie zwrócił JSON: " + responseText);
        }

        if (!uploadResponse.ok) {
            const apiError = result.error ? `${result.error.code}: ${result.error.message}` : "Błąd " + uploadResponse.status;
            throw new Error("Google API odmówił -> " + apiError);
        }

        if (result.file && result.file.uri) {
            const newFileObj = {
                fileUri: result.file.uri,
                mimeType: mimeType,
                name: file.name,
                uploadedAt: Date.now()
            };
            chrome.storage.local.set({ customContextFile: newFileObj, learnedContext: null }, () => {
                updateFileStatus(newFileObj, null);
            });
        } else {
            throw new Error("Brak URI w odpowiedzi.");
        }
    } catch (e) {
        statusDiv.innerText = e.name + ": " + e.message;
        statusDiv.style.color = "#ef4444";
    }
});

clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['customContextFile', 'learnedContext'], () => {
        statusDiv.innerText = "";
        fileInput.value = "";
        trainModelSelect.disabled = true;
        trainCountInput.disabled = true;
        trainBtn.disabled = true;
    });
});
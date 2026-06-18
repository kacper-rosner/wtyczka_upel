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
import { API_KEY } from "./api.js";


chrome.storage.local.get(['contextEnabled', 'knowledgeModeEnabled', 'hideButtons', 'hideLogs', 'lastAiResponse', 'pdfRead', 'customContextFile'], (result) => {
    const isEnabled = result.contextEnabled === true;
    toggle.checked = isEnabled;
    knowledgeToggle.checked = result.knowledgeModeEnabled === true;
    hideButtonsToggle.checked = result.hideButtons === true;
    hideLogsToggle.checked = result.hideLogs === true;
    
    updateUI(isEnabled);
    updateVisibility();
    updateFileStatus(result.customContextFile);
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

function updateFileStatus(fileObj) {
    if (!fileObj) {
        statusDiv.innerText = "";
        return;
    }
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const timePassed = Date.now() - fileObj.uploadedAt;
    if (timePassed > ONE_DAY_MS) {
        statusDiv.innerText = `[WYGASŁ] Plik ${fileObj.name} wygasł po 24h. Wgraj ponownie.`;
        statusDiv.style.color = "#ef4444";
    } else {
        const hoursLeft = Math.round((ONE_DAY_MS - timePassed) / (1000 * 60 * 60));
        statusDiv.innerText = `[GOTOWE] Wgrano: ${fileObj.name} (Zostało ok. ${hoursLeft}h)`;
        statusDiv.style.color = "#16a34a";
    }
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
            body: JSON.stringify({
                file: { displayName: file.name }
            })
        });

        if (!initResponse.ok) {
            const text = await initResponse.text();
            throw new Error(`Inicjalizacja nieudana (${initResponse.status}): ${text}`);
        }

        const uploadUrl = initResponse.headers.get("X-Goog-Upload-URL");
        if (!uploadUrl) {
            throw new Error("Nie otrzymano dedykowanego URL uploadu od Google.");
        }

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
            throw new Error("Serwer nie zwrócił poprawnego JSON: " + responseText);
        }

        if (!uploadResponse.ok) {
            const apiError = result.error ? `${result.error.code}: ${result.error.message}` : "Błąd " + uploadResponse.status;
            throw new Error("Google API odmówił zapisu -> " + apiError);
        }

        if (result.file && result.file.uri) {
            const newFileObj = {
                fileUri: result.file.uri,
                mimeType: mimeType,
                name: file.name,
                uploadedAt: Date.now()
            };
            chrome.storage.local.set({ customContextFile: newFileObj }, () => {
                updateFileStatus(newFileObj);
            });
        } else {
            throw new Error("Brak parametru file.uri w odpowiedzi serwera.");
        }
    } catch (e) {
        console.error("PEŁNY ZRZUT BŁĘDU DEWELOPERSKIEGO:", e);
        statusDiv.innerText = e.name + ": " + e.message;
        statusDiv.style.color = "#ef4444";
    }
});

clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('customContextFile', () => {
        statusDiv.innerText = "";
        fileInput.value = "";
    });
});
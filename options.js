const toggle = document.getElementById('enableContextToggle');
const knowledgeToggle = document.getElementById('knowledgeModeToggle');
const fileInput = document.getElementById('fileInput');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusDiv = document.getElementById('status');

chrome.storage.local.get(['contextEnabled', 'knowledgeModeEnabled'], (result) => {
    const isEnabled = result.contextEnabled === true;
    toggle.checked = isEnabled;
    knowledgeToggle.checked = result.knowledgeModeEnabled === true;
    updateUI(isEnabled);
});

toggle.addEventListener('change', (e) => {
    const isEnabled = e.target.checked;
    chrome.storage.local.set({ contextEnabled: isEnabled }, () => {
        updateUI(isEnabled);
        statusDiv.innerText = isEnabled ? "Obsługa kontekstu włączona." : "Obsługa kontekstu wyłączona.";
    });
});

knowledgeToggle.addEventListener('change', (e) => {
    const isKnowledgeEnabled = e.target.checked;
    chrome.storage.local.set({ knowledgeModeEnabled: isKnowledgeEnabled }, () => {
        statusDiv.innerText = isKnowledgeEnabled ? "Tryb Knowledge włączony." : "Tryb Knowledge wyłączony.";
    });
});

function updateUI(isEnabled) {
    fileInput.disabled = !isEnabled;
    saveBtn.disabled = !isEnabled;
    clearBtn.disabled = !isEnabled;
}

saveBtn.addEventListener('click', () => {
    const file = fileInput.files[0];

    if (!file) {
        statusDiv.innerText = "Wybierz najpierw plik.";
        return;
    }

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
            statusDiv.innerText = `Zapisano plik: ${file.name}`;
        });
    };

    reader.readAsDataURL(file);
});

clearBtn.addEventListener('click', () => {
    chrome.storage.local.remove('customContextFile', () => {
        statusDiv.innerText = "Kontekst wyczyszczony.";
        fileInput.value = "";
    });
});
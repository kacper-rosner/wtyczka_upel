import { API_KEY } from './api.js';

let availableModels = [];

async function getAvailableModels() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();

        const textModels = data.models.filter(m =>
            m.supportedGenerationMethods &&
            m.supportedGenerationMethods.includes('generateContent') &&
            m.name.includes('gemini') &&
            !m.name.includes('vision') &&
            !m.name.includes('audio') &&
            !m.name.includes('tts') &&
            !m.name.includes('image')
        );

        const sortedModels = textModels.sort((a, b) => {
            const getScore = (name) => {
                let score = 0;
                if (name.includes('lite')) score += 100;
                if (name.includes('flash')) score += 50;
                if (!name.includes('preview')) score += 10;
                return score;
            };
            return getScore(b.name) - getScore(a.name);
        });
        return sortedModels.map(m => m.name.replace('models/', ''));
    } catch (e) {
        return ['gemini-2.0-flash-lite'];
    }
}

(async () => {
    availableModels = await getAvailableModels();
})();

chrome.commands.onCommand.addListener((command) => {
    if (command === "trigger-ai") {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            const currentTab = tabs[0];
            if (currentTab?.id) {
                if (currentTab.url && currentTab.url.startsWith("chrome://")) return;
                chrome.tabs.sendMessage(currentTab.id, {action: "startAnalysis"}).catch(() => {});
            }
        });
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchAI") {
        processAIWithFallback(request)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
    
    if (request.action === "getModels") {
        (async () => {
            if (availableModels.length === 0) availableModels = await getAvailableModels();
            sendResponse({ models: availableModels });
        })();
        return true;
    }

    if (request.action === "trainContext") {
        trainContext(request.model, request.count)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
});

async function trainContext(modelName, questionCount) {
    const storageData = await chrome.storage.local.get(['customContextFile']);
    if (!storageData.customContextFile || !storageData.customContextFile.fileUri) {
        throw new Error("Brak wgranego pliku PDF do przeprowadzenia treningu.");
    }

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    if (Date.now() - storageData.customContextFile.uploadedAt > ONE_DAY_MS) {
        throw new Error("Zapisany plik wygasł (TTL 24h). Wgraj go ponownie, aby trenować.");
    }

    const promptText = `Jesteś systemem trenującym i bezwzględnym analitykiem weryfikującym własną wiedzę.\nNa podstawie załączonego pliku wykonaj następujące kroki:\n1. Wygeneruj dokładnie ${questionCount} wysoce zaawansowanych i podchwytliwych pytań wyciągających esencję z tego pliku.\n2. Samodzielnie odpowiedz na te pytania, opierając się WYŁĄCZNIE na danych z pliku.\n3. Przeprowadź brutalną weryfikację własnych odpowiedzi (porównaj je ponownie z dokumentem i napraw ewentualne nieścisłości).\n4. Na podstawie powyższego procesu, stwórz gęsty, skompresowany \"Wyuczony Kontekst\" - notatkę zawierającą absolutnie kluczowe powiązania, wzory, definicje i zasady wynikające z dokumentu.\n\nZWRÓĆ TYLKO I WYŁĄCZNIE CZYSTY TEKST \"WYUCZONEGO KONTEKSTU\". Pomiń proces, nie wypisuj pytań, pomiń wstępy i zakończenia. Chcę dostać tylko czystą esencję po treningu.`;

    const promptParts = [
        { text: promptText },
        { fileData: { fileUri: storageData.customContextFile.fileUri, mimeType: storageData.customContextFile.mimeType } }
    ];

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: promptParts }] })
    });

    if (!response.ok) {
        throw new Error(`Błąd treningu HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.error) {
        throw new Error(result.error.message);
    }

    const learnedData = result.candidates[0].content.parts[0].text;
    await chrome.storage.local.set({ learnedContext: learnedData });
    return { success: true };
}

async function processAIWithFallback(data) {
    if (availableModels.length === 0) {
        availableModels = await getAvailableModels();
    }

    let instruction = `Jesteś ekspertem z dziedziny: ${data.context}. Rozwiąż poniższe zadanie.\nZawsze dodawaj do struktury JSON pole "pdf_read": true (jeśli otrzymałeś w kontekście zewnętrzny plik i z niego skorzystałeś) lub false (jeśli plik nie został dodany lub był niepotrzebny).\n\n`;

    if (data.fieldType === 'radio') {
        instruction += `UWAGA: To zadanie testowe wyboru (radio).\nZwróć TYLKO I WYŁĄCZNIE CZYSTY JSON w formacie: {"answers": [1], "pdf_read": true/false} lub {"answers": [1, 3], "pdf_read": true/false} (gdzie liczby to numery poprawnych odpowiedzi liczone od 1).\nNIE UŻYWAJ znaczników markdown, backticków (\`\`\`) ani żadnego tekstu przed/po obiekcie JSON.\n`;
    } else if (data.fieldType === 'input') {
        instruction += `UWAGA: Zadanie posiada pola wpisywania.\nZwróć TYLKO I WYŁĄCZNIE CZYSTY JSON w formacie: {"answers": ["wartosc1", "wartosc2"], "pdf_read": true/false} (tablica 'answers' zawiera gotowe wartości dla kolejnych pól na stronie w idealnej kolejności od góry do dołu).\nNIE UŻYWAJ znaczników markdown, backticków (\`\`\`) ani żadnego tekstu przed/po obiekcie JSON.\n`;
    } else {
        instruction += `Zwróć TYLKO I WYŁĄCZNIE CZYSTY JSON w formacie: {"answer": "rozwiązanie zadania", "pdf_read": true/false}.\nNIE UŻYWAJ znaczników markdown, backticków (\`\`\`) ani tekstu.\n`;
    }

    const storageData = await chrome.storage.local.get(['customContextFile', 'contextEnabled', 'knowledgeModeEnabled', 'learnedContext']);
    
    if (storageData.contextEnabled && storageData.learnedContext) {
        instruction += `\n--- WYUCZONY KONTEKST BAZOWY ---\nOto przetworzona i zweryfikowana esencja wiedzy wynikająca z dostarczonego pliku bazowego. Traktuj to jako dogmat:\n${storageData.learnedContext}\n----------------------------------\n\n`;
    }

    const promptParts = [{ text: instruction + "ZADANIE:\n" + data.text }];

    if (storageData.contextEnabled && storageData.customContextFile && storageData.customContextFile.fileUri) {
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - storageData.customContextFile.uploadedAt < ONE_DAY_MS) {
            promptParts.push({
                fileData: {
                    fileUri: storageData.customContextFile.fileUri,
                    mimeType: storageData.customContextFile.mimeType
                }
            });
        }
    }

    let currentModelsQueue = [...availableModels];

    if (storageData.knowledgeModeEnabled) {
        currentModelsQueue.sort((a, b) => {
            const getKnowledgeScore = (name) => {
                let score = 0;
                if (name.includes('pro')) score += 100;
                if (name.includes('flash') && !name.includes('lite')) score += 50;
                if (!name.includes('preview')) score += 10;
                return score;
            };
            return getKnowledgeScore(b) - getKnowledgeScore(a);
        });
    }

    for (let i = 0; i < currentModelsQueue.length; i++) {
        const currentModel = currentModelsQueue[i];
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: promptParts }]
                })
            });

            if (response.status === 429) continue;

            const result = await response.json();
            
            if (result.error) {
                if (result.error.code === 429 || result.error.status === 'RESOURCE_EXHAUSTED') continue;
                return { error: result.error.message };
            }
            
            return { reply: result.candidates[0].content.parts[0].text, fieldType: data.fieldType };
        } catch (e) {
            if (i === currentModelsQueue.length - 1) return { error: "Błąd sieci: " + e.message };
        }
    }

    return { error: "Wyczerpano limit zapytań dla wszystkich dostępnych modeli." };
}
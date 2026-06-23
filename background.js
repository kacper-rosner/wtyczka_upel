import { API_KEY } from './api.js';

let availableModels = [];
const QUESTION_LOG_KEY = 'savedQuestionLog';
const QUESTION_LOG_LIMIT = 500;

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
    if (request.action === "saveQuestionSnapshot") {
        saveQuestionSnapshot(request.snapshot)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }

    if (request.action === "updateLastQuestionAiAnswer") {
        updateLastQuestionAiAnswer(request.aiAnswer)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }

    if (request.action === "getSavedQuestionsTxt") {
        getSavedQuestionsTxt()
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }

    if (request.action === "clearSavedQuestions") {
        chrome.storage.local.remove([QUESTION_LOG_KEY], () => sendResponse({ success: true, count: 0 }));
        return true;
    }

    if (request.action === "fetchAI") {
        if (request.questionSnapshot) {
            saveQuestionSnapshot(request.questionSnapshot).catch(() => {});
        }
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


async function saveQuestionSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return { success: false, count: 0 };
    }

    const storageData = await chrome.storage.local.get([QUESTION_LOG_KEY]);
    let log = Array.isArray(storageData[QUESTION_LOG_KEY]) ? storageData[QUESTION_LOG_KEY] : [];

    const prepared = normalizeQuestionSnapshot(snapshot);
    const existingIndex = log.findIndex(item => item.fingerprint === prepared.fingerprint);

    if (existingIndex >= 0) {
        log[existingIndex] = {
            ...log[existingIndex],
            ...prepared,
            savedAt: log[existingIndex].savedAt || prepared.savedAt,
            updatedAt: new Date().toISOString(),
            aiAnswer: log[existingIndex].aiAnswer || prepared.aiAnswer || ''
        };
    } else {
        log.push(prepared);
    }

    if (log.length > QUESTION_LOG_LIMIT) {
        log = log.slice(log.length - QUESTION_LOG_LIMIT);
    }

    await chrome.storage.local.set({ [QUESTION_LOG_KEY]: log });
    return { success: true, count: log.length };
}

function normalizeQuestionSnapshot(snapshot) {
    const questionText = trimExportText(snapshot.questionText || snapshot.rawText || '', 15000);
    const selectFields = Array.isArray(snapshot.selectFields) ? snapshot.selectFields : [];
    const choiceFields = Array.isArray(snapshot.choiceFields) ? snapshot.choiceFields : [];
    const imageInfo = Array.isArray(snapshot.imageInfo) ? snapshot.imageInfo : [];
    const fingerprint = snapshot.fingerprint || makeBackgroundHash([
        snapshot.pageUrl || '',
        questionText,
        JSON.stringify(selectFields),
        JSON.stringify(choiceFields)
    ].join('|'));

    return {
        fingerprint,
        savedAt: snapshot.savedAt || new Date().toISOString(),
        pageTitle: trimExportText(snapshot.pageTitle || '', 300),
        pageUrl: trimExportText(snapshot.pageUrl || '', 2000),
        context: trimExportText(snapshot.context || '', 500),
        fieldType: snapshot.fieldType || 'unknown',
        questionText,
        rawText: trimExportText(snapshot.rawText || '', 15000),
        textFieldCount: Number(snapshot.textFieldCount || 0),
        choiceFields,
        selectFields,
        imageInfo,
        aiAnswer: snapshot.aiAnswer || ''
    };
}

async function updateLastQuestionAiAnswer(aiAnswer) {
    const storageData = await chrome.storage.local.get([QUESTION_LOG_KEY]);
    const log = Array.isArray(storageData[QUESTION_LOG_KEY]) ? storageData[QUESTION_LOG_KEY] : [];

    if (!log.length) return { success: false, count: 0 };

    log[log.length - 1] = {
        ...log[log.length - 1],
        aiAnswer: trimExportText(aiAnswer || '', 5000),
        updatedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({ [QUESTION_LOG_KEY]: log });
    return { success: true, count: log.length };
}

async function getSavedQuestionsTxt() {
    const storageData = await chrome.storage.local.get([QUESTION_LOG_KEY]);
    const log = Array.isArray(storageData[QUESTION_LOG_KEY]) ? storageData[QUESTION_LOG_KEY] : [];
    return {
        success: true,
        count: log.length,
        text: buildQuestionsTxt(log)
    };
}

function buildQuestionsTxt(log) {
    const now = new Date().toLocaleString('pl-PL');
    const lines = [];

    lines.push('AI Reader - zapis treści zadań i odpowiedzi do wyboru');
    lines.push(`Wygenerowano: ${now}`);
    lines.push(`Liczba zapisanych pytań: ${log.length}`);
    lines.push('');
    lines.push('='.repeat(80));

    if (!log.length) {
        lines.push('Brak zapisanych pytań. Najpierw kliknij „Rozwiąż zadanie” na stronie z pytaniem.');
        return lines.join('\n');
    }

    log.forEach((item, index) => {
        lines.push('');
        lines.push(`PYTANIE ${index + 1}`);
        lines.push('-'.repeat(80));
        lines.push(`Data zapisu: ${formatDateForTxt(item.savedAt)}`);
        if (item.updatedAt) lines.push(`Ostatnia aktualizacja: ${formatDateForTxt(item.updatedAt)}`);
        if (item.context) lines.push(`Kontekst/temat: ${item.context}`);
        if (item.pageTitle) lines.push(`Tytuł strony: ${item.pageTitle}`);
        if (item.pageUrl) lines.push(`Adres strony: ${item.pageUrl}`);
        lines.push(`Typ pól: ${item.fieldType || 'unknown'}`);
        lines.push('');
        lines.push('TREŚĆ ZADANIA:');
        lines.push(item.questionText || item.rawText || '[brak tekstu]');
        lines.push('');

        appendChoiceFields(lines, item.choiceFields);
        appendSelectFields(lines, item.selectFields);

        if (item.textFieldCount) {
            lines.push('');
            lines.push(`POLA DO WPISANIA: ${item.textFieldCount}`);
        }

        appendImages(lines, item.imageInfo);

        if (item.aiAnswer) {
            lines.push('');
            lines.push('ODPOWIEDŹ AI / WYBRANE ROZWIĄZANIE:');
            lines.push(item.aiAnswer);
        }

        lines.push('');
        lines.push('='.repeat(80));
    });

    return lines.join('\n');
}

function appendChoiceFields(lines, choiceFields) {
    if (!Array.isArray(choiceFields) || !choiceFields.length) return;

    lines.push('ODPOWIEDZI DO WYBORU - RADIO/CHECKBOX:');
    choiceFields.forEach((group, groupIndex) => {
        lines.push(``);
        lines.push(`Grupa ${groupIndex + 1}${group.label ? `: ${group.label}` : ''} (${group.type || 'choice'})`);
        (group.choices || []).forEach((choice, choiceIndex) => {
            const number = choice.number || choiceIndex + 1;
            const valueInfo = choice.value ? ` [value="${choice.value}"]` : '';
            lines.push(`${number}. ${choice.text || '[brak tekstu opcji]'}${valueInfo}`);
        });
    });
}

function appendSelectFields(lines, selectFields) {
    if (!Array.isArray(selectFields) || !selectFields.length) return;

    lines.push('');
    lines.push('LISTY ROZWIJANE / DOPASOWYWANIE:');
    selectFields.forEach((field, fieldIndex) => {
        lines.push('');
        lines.push(`Pole ${fieldIndex + 1}: ${field.label || ''}`.trim());
        (field.options || []).forEach((option, optionIndex) => {
            const number = option.number || optionIndex + 1;
            const valueInfo = option.value ? ` [value="${option.value}"]` : '';
            lines.push(`${number}. ${option.text || '[brak tekstu opcji]'}${valueInfo}`);
        });
    });
}

function appendImages(lines, imageInfo) {
    if (!Array.isArray(imageInfo) || !imageInfo.length) return;

    lines.push('');
    lines.push('OBRAZKI W ZADANIU:');
    imageInfo.forEach((img, index) => {
        const details = [];
        if (img.alt) details.push(`alt="${img.alt}"`);
        if (img.title) details.push(`title="${img.title}"`);
        if (img.width && img.height) details.push(`${img.width}x${img.height}`);
        if (img.src) details.push(`url=${img.src}`);
        lines.push(`${index + 1}. ${details.join(' | ') || 'obrazek bez opisu'}`);
    });
}

function formatDateForTxt(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('pl-PL');
}

function trimExportText(text, maxLength) {
    const value = String(text || '').replace(/\s+\n/g, '\n').trim();
    return value.length > maxLength ? value.slice(0, maxLength - 20) + '\n...[ucięto]' : value;
}

function makeBackgroundHash(text) {
    let hash = 0;
    const value = String(text || '');
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return `q_${Math.abs(hash)}`;
}

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


function normalizeIncomingImages(data) {
    const rawImages = Array.isArray(data?.images)
        ? data.images
        : (Array.isArray(data?.imageData) ? data.imageData : []);

    return rawImages
        .map((image) => parseImageDataUrl(image?.dataUrl || image?.image_url || image?.src || image))
        .filter(Boolean)
        .slice(0, 6);
}

function parseImageDataUrl(value) {
    if (typeof value !== 'string') return null;

    const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;

    return {
        mimeType: match[1],
        data: match[2]
    };
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
    } else if (data.fieldType === 'select') {
        instruction += `UWAGA: Zadanie posiada listy rozwijane/select, często typu dopasuj słowa do tłumaczeń.\nW treści zadania znajdziesz sekcję "POLA WYBORU / LISTY ROZWIJANE". Dla każdego pola wybierz dokładną opcję z podanej listy.\nZwróć TYLKO I WYŁĄCZNIE CZYSTY JSON w formacie: {"answers": ["dokładny tekst opcji dla pola 1", "dokładny tekst opcji dla pola 2"], "pdf_read": true/false}.\nMożesz zwrócić też numery opcji, ale tylko liczone od 1 według list opcji wypisanych przy każdym polu.\nNIE UŻYWAJ znaczników markdown, backticków (\`\`\`) ani żadnego tekstu przed/po obiekcie JSON.\n`;
    } else {
        instruction += `Zwróć TYLKO I WYŁĄCZNIE CZYSTY JSON w formacie: {"answer": "rozwiązanie zadania", "pdf_read": true/false}.\nNIE UŻYWAJ znaczników markdown, backticków (\`\`\`) ani tekstu.\n`;
    }

    const storageData = await chrome.storage.local.get(['customContextFile', 'contextEnabled', 'knowledgeModeEnabled', 'learnedContext']);
    
    if (storageData.contextEnabled && storageData.learnedContext) {
        instruction += `\n--- WYUCZONY KONTEKST BAZOWY ---\nOto przetworzona i zweryfikowana esencja wiedzy wynikająca z dostarczonego pliku bazowego. Traktuj to jako dogmat:\n${storageData.learnedContext}\n----------------------------------\n\n`;
    }

    const promptParts = [{ text: instruction + "ZADANIE:\n" + data.text }];

    const inlineImages = normalizeIncomingImages(data);
    if (inlineImages.length > 0) {
        promptParts.push({
            text: `\n--- OBRAZKI Z ZADANIA ---\nDo zadania dołączono ${inlineImages.length} obrazek/obrazki. Odczytaj z nich treść, wzory, wykresy, tabele i uwzględnij je przy wyborze odpowiedzi. Obrazki są podane poniżej jako inlineData.\n`
        });

        inlineImages.forEach((image) => {
            promptParts.push({
                inlineData: {
                    mimeType: image.mimeType,
                    data: image.data
                }
            });
        });
    }

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
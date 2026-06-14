import { API_KEY } from "./api.js";
let availableModels = [];

async function getAvailableModels() {
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();

        const textModels = data.models.filter(m =>
            m.supportedGenerationMethods &&
            m.supportedGenerationMethods.includes('generateContent') &&
            m.name.includes('gemini') &&
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
        return ['gemini-3.1-flash-lite'];
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
});

async function processAIWithFallback(data) {
    if (availableModels.length === 0) {
        availableModels = await getAvailableModels();
    }

    let instruction = `Jesteś ekspertem z dziedziny: ${data.context}.\n\n`;
    
    // Rozróżnienie promptu w zależności od wybranego przycisku (solve / verify)
    if (data.mode === 'verify') {
        instruction += `ZADANIE UŻYTKOWNIKA: Przeanalizuj treść zadania oraz sprawdź, czy aktualnie zaznaczone/wpisane przez użytkownika odpowiedzi (widoczne w treści zadania jako stan tekstowy lub zaznaczenie) są poprawne.\n`;
        instruction += `INSTRUKCJA ZWROTNA:\n`;
        instruction += `1. Jeśli użytkownik odpowiedział dobrze, zwróć wyłącznie frazę: ODPOWIEDZ_POPRAWNA\n`;
        instruction += `2. Jeśli użytkownik popełnił błąd, rozpocznij odpowiedź od słowa ODPOWIEDZ_BLEDNA, a następnie wyjaśnij zwięźle dlaczego to błąd. Na samym końcu wypowiedzi podaj prawidłowe rozwiązanie w formacie JSON (czysty JSON bez markdownu), tak aby system mógł je podmienić, np:\n`;
        if (data.fieldType === 'radio') {
            instruction += `{"answers": [1]}\n`;
        } else {
            instruction += `{"ans1": "wartosc1"}\n`;
        }
    } else {
        // Standardowy tryb rozwiązywania (solve)
        instruction += "Rozwiąż poniższe zadanie.\n";
        if (data.fieldType === 'radio') {
            instruction += `UWAGA: To zadanie testowe wyboru (radio). Zwrć TYLKO I WYŁĄCZNIE CZYSTY JSON w formacie: {"answers": [1]} lub {"answers": [1, 3]} (gdzie liczby to numery poprawnych odpowiedzi liczone od 1). NIE UŻYWAJ znaczników markdown, backticków (\`\`\`) ani żadnego tekstu przed/po obiekcie JSON.\n`;
        } else if (data.fieldType === 'input') {
            instruction += `UWAGA: Zadanie posiada pola wpisywania. Zwróć TYLKO I WYŁĄCZNIE CZYSTY JSON w formacie: {"ans1": "wartosc1", "ans2": "wartosc2"} zgodnie z kolejnością występowania pól. NIE UŻYWAJ znaczników markdown, backticków (\`\`\`) ani żadnego tekstu przed/po obiekcie JSON.\n`;
        } else {
            instruction += "Zwróć rozwiązanie w krótkiej, zwięzłej formie tekstowej.\n";
        }
    }

    // Przygotowanie tablicy zawartości dla Gemini
    const requestParts = [{ text: instruction + "ZADANIE:\n" + data.text }];

    if (data.imageUrl) {
        const imageData = await imageUrlToBase64(data.imageUrl);
        if (imageData) {
            requestParts.push({
                inlineData: {
                    mimeType: imageData.mimeType,
                    data: imageData.data
                }
            });
        }
    }

    for (let i = 0; i < availableModels.length; i++) {
        const currentModel = availableModels[i];
        
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: requestParts }]
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
            if (i === availableModels.length - 1) return { error: "Błąd sieci: " + e.message };
        }
    }

    return { error: "Wyczerpano limit zapytań dla wszystkich dostępnych modeli. Odczekaj chwilę." };
}

async function imageUrlToBase64(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Data = reader.result.split(',')[1];
                resolve({
                    mimeType: blob.type || "image/png",
                    data: base64Data
                });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Nie udało się pobrać lub przekonwertować obrazka:", e);
        return null;
    }
}
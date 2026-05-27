chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "startAnalysis") {
        const taskElement = document.querySelector('.formulation.clearfix');
        const contextElement = document.querySelector('.page-context-header.d-flex.flex-wrap.align-items-center.mb-2');
        
        if (!taskElement) {
            showResponseDiv("Nie znaleziono głównej treści zadania.");
            return;
        }

        const contextText = contextElement ? contextElement.innerText : "Ogólna wiedza";
        const taskText = taskElement.innerText;

        const inputs = taskElement.querySelectorAll('input[type="text"], input[type="number"]');
        const radios = taskElement.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        
        const hasInputs = inputs.length > 0;
        const hasRadios = radios.length > 0;
        
        const fieldType = hasRadios ? 'radio' : (hasInputs ? 'input' : 'text');

        showResponseDiv("AI analizuje i wypełnia zadanie...");

        chrome.runtime.sendMessage(
            { action: "fetchAI", text: taskText, context: contextText, fieldType: fieldType },
            (response) => {
                if (chrome.runtime.lastError) {
                    showResponseDiv("Błąd komunikacji z procesem w tle.");
                    return;
                }

                if (response && response.error) {
                    showResponseDiv("Błąd: " + response.error);
                    return;
                }

                if (response && response.reply) {
                    handleAIResponse(response.reply, response.fieldType, inputs, radios);
                } else {
                    showResponseDiv("Nieznany błąd podczas odbierania odpowiedzi.");
                }
            }
        );
    }
});

function handleAIResponse(replyText, fieldType, inputs, radios) {
    if (fieldType === 'text') {
        showResponseDiv(replyText);
        return;
    }

    // 1. Czyszczenie odpowiedzi ze znaczników markdown, jeśli model mimo instrukcji je doda
    let cleanJsonString = replyText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // Zabezpieczenie przed tekstem przed klamrą
    const jsonStartIndex = cleanJsonString.indexOf('{');
    const jsonEndIndex = cleanJsonString.lastIndexOf('}');
    if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
        cleanJsonString = cleanJsonString.substring(jsonStartIndex, jsonEndIndex + 1);
    }

    try {
        // 2. Parsowanie odpowiedzi do obiektu JS
        const aiData = JSON.parse(cleanJsonString);
        let actionLog = "Pomyślnie zdekodowano JSON.\n\n";

        // 3. Automatyczne wypełnianie RADIO / CHECKBOX
        if (fieldType === 'radio' && aiData.answers) {
            aiData.answers.forEach(ansNum => {
                const index = parseInt(ansNum) - 1; // Tablice w JS są indeksowane od 0, ludzkie liczenie od 1
                if (radios[index]) {
                    radios[index].checked = true;
                    // Wywołanie zdarzenia dla nowoczesnych frameworków front-end
                    radios[index].dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            actionLog += `Zaznaczono poprawne opcje: ${aiData.answers.join(', ')}`;
            showResponseDiv(actionLog);
        }

        // 4. Automatyczne wypełnianie INPUTÓW tekstowych / numerycznych
        if (fieldType === 'input') {
            let filledCount = 0;
            Object.keys(aiData).forEach((key) => {
                // Wyciąganie numeru z klucza (np. "ans2" -> 2)
                const match = key.match(/\d+/);
                if (match) {
                    const index = parseInt(match[0]) - 1;
                    if (inputs[index]) {
                        inputs[index].value = aiData[key];
                        // Wywołanie zdarzeń symulujących zachowanie człowieka
                        inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
                        inputs[index].dispatchEvent(new Event('change', { bubbles: true }));
                        filledCount++;
                    }
                }
            });
            actionLog += `Wypełniono ${filledCount} pól tekstowych/numerycznych.`;
            showResponseDiv(actionLog);
        }

    } catch (e) {
        // Fallback: Jeśli AI całkowicie zepsuje odpowiedź i JSON się nie sparsuje, pokazujemy treść użytkownikowi
        console.error("Błąd parsowania JSON:", cleanJsonString, e);
        showResponseDiv("Model zwrócił format, którego nie udało się automatycznie wypełnić. Oto odpowiedź:\n\n" + replyText);
    }
}

function showResponseDiv(text) {
    let resultDiv = document.getElementById('ai-extension-result');
    if (!resultDiv) {
        resultDiv = document.createElement('div');
        resultDiv.id = 'ai-extension-result';
        Object.assign(resultDiv.style, {
            position: 'fixed', top: '20px', right: '20px', width: '350px',
            maxHeight: '80vh', overflowY: 'auto', backgroundColor: '#1e293b',
            color: '#f8fafc', border: '2px solid #38bdf8', borderRadius: '12px',
            padding: '20px', zIndex: '999999', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            fontFamily: 'Segoe UI, sans-serif', fontSize: '14px', lineHeight: '1.6'
        });
        document.body.appendChild(resultDiv);
    }
    resultDiv.innerText = text;
}
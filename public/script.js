let conversationId = null;
let currentImage = null;
let messageCounter = 0;

const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const imageButton = document.getElementById('imageButton');
const imageInput = document.getElementById('imageInput');
const imagePreview = document.getElementById('imagePreview');
const previewImg = document.getElementById('previewImg');
const removeImageBtn = document.getElementById('removeImage');
const usernameInput = document.getElementById('usernameInput');

function addMessage(content, role, imageData = null, messageId = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    if (messageId) {
        messageDiv.dataset.messageId = messageId;
    }

    const labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = role === 'user' ? 'You' : 'Assistant';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Add image if present
    if (imageData) {
        const img = document.createElement('img');
        img.src = imageData;
        img.className = 'message-image';
        img.alt = 'Attached image';
        contentDiv.appendChild(img);
    }

    // Add text content
    if (content) {
        const textDiv = document.createElement('div');
        textDiv.textContent = content;
        contentDiv.appendChild(textDiv);
    }

    messageDiv.appendChild(labelDiv);
    messageDiv.appendChild(contentDiv);

    // Add feedback buttons for assistant messages
    if (role === 'assistant' && messageId) {
        const feedbackDiv = document.createElement('div');
        feedbackDiv.className = 'feedback-buttons';

        const thumbsUpBtn = document.createElement('button');
        thumbsUpBtn.className = 'feedback-btn thumbs-up';
        thumbsUpBtn.innerHTML = '👍';
        thumbsUpBtn.onclick = () => sendFeedback(messageId, 'up', thumbsUpBtn, thumbsDownBtn);

        const thumbsDownBtn = document.createElement('button');
        thumbsDownBtn.className = 'feedback-btn thumbs-down';
        thumbsDownBtn.innerHTML = '👎';
        thumbsDownBtn.onclick = () => sendFeedback(messageId, 'down', thumbsDownBtn, thumbsUpBtn);

        feedbackDiv.appendChild(thumbsUpBtn);
        feedbackDiv.appendChild(thumbsDownBtn);
        contentDiv.appendChild(feedbackDiv);
    }

    messagesContainer.appendChild(messageDiv);

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addLoadingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.id = 'loading-message';
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = 'Assistant';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = '<div class="loading"></div>';
    
    messageDiv.appendChild(labelDiv);
    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeLoadingMessage() {
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
        loadingMessage.remove();
    }
}

async function sendMessage() {
    const message = messageInput.value.trim();
    const hasImage = currentImage !== null;

    if (!message && !hasImage) return;

    // Get username
    const username = usernameInput.value.trim() || 'User';

    // Add user message to UI
    addMessage(message, 'user', currentImage);
    messageInput.value = '';
    sendButton.disabled = true;

    // Show loading indicator
    addLoadingMessage();

    try {
        const requestBody = {
            message: message || '(image)',
            conversationId,
            username,
            image: currentImage,
        };

        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to get response');
        }

        // Update conversation ID
        conversationId = data.conversationId;

        // Remove loading and add assistant response with message ID
        removeLoadingMessage();
        addMessage(data.response, 'assistant', null, data.messageId);

        // Clear the image
        clearImage();
    } catch (error) {
        removeLoadingMessage();
        addMessage(`Error: ${error.message}`, 'assistant');
        console.error('Error:', error);
    } finally {
        sendButton.disabled = false;
        messageInput.focus();
    }
}

async function sendFeedback(messageId, feedbackType, activeBtn, otherBtn) {
    try {
        const username = usernameInput.value.trim() || 'User';

        const response = await fetch('/api/feedback', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messageId,
                feedback: feedbackType,
                username,
                conversationId,
            }),
        });

        if (response.ok) {
            // Mark button as active
            activeBtn.classList.add('active');
            otherBtn.classList.remove('active');

            // Disable both buttons after feedback
            activeBtn.disabled = true;
            otherBtn.disabled = true;
        }
    } catch (error) {
        console.error('Error sending feedback:', error);
    }
}

// Image handling
imageButton.addEventListener('click', () => {
    imageInput.click();
});

imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            currentImage = event.target.result;
            previewImg.src = currentImage;
            imagePreview.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
});

removeImageBtn.addEventListener('click', clearImage);

function clearImage() {
    currentImage = null;
    imageInput.value = '';
    imagePreview.style.display = 'none';
    previewImg.src = '';
}

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Focus input on load
messageInput.focus();

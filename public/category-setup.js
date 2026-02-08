// Category Setup Logic

let selectedCategories = {
    income: [],
    expense: []
};

// Toggle category selection
function toggleCategory(element, type, category) {
    if (element.classList.contains('selected')) {
        element.classList.remove('selected');
        selectedCategories[type] = selectedCategories[type].filter(c => c !== category);
    } else {
        element.classList.add('selected');
        if (!selectedCategories[type].includes(category)) {
            selectedCategories[type].push(category);
        }
    }
}

// Add custom category
function addCustomCategory(type) {
    const inputId = type === 'income' ? 'customIncome' : 'customExpense';
    const input = document.getElementById(inputId);
    const category = input.value.trim();

    if (!category) {
        alert('Please enter a category name');
        return;
    }

    // Add pill to UI
    const pillsContainer = document.getElementById(type + 'Pills');
    const pill = document.createElement('div');
    pill.className = `category-pill ${type} selected`;
    pill.textContent = category;
    pill.onclick = function() { toggleCategory(this, type, category); };
    pillsContainer.appendChild(pill);

    // Add to selected categories
    if (!selectedCategories[type].includes(category)) {
        selectedCategories[type].push(category);
    }

    // Clear input
    input.value = '';
}

// Save categories to Firestore
async function saveCategories() {
    if (selectedCategories.income.length === 0 && selectedCategories.expense.length === 0) {
        alert('Please select at least one category');
        return;
    }

    // Wait for Firebase to be ready
    await new Promise(resolve => {
        function checkFirebase() {
            if (window.auth && window.auth.currentUser && window.setDoc && window.doc && window.db) {
                resolve();
            } else {
                setTimeout(checkFirebase, 50);
            }
        }
        checkFirebase();
    });

    document.getElementById('pageLoader').classList.add('active');

    try {
        const user = window.auth.currentUser;
        
        // Save to Firestore
        await window.setDoc(
            window.doc(window.db, 'users', user.uid, 'settings', 'categories'),
            {
                income: selectedCategories.income,
                expense: selectedCategories.expense,
                setupCompleted: true,
                createdAt: window.serverTimestamp()
            }
        );

        // Redirect to main app
        window.location.href = 'index.html';
    } catch (error) {
        document.getElementById('pageLoader').classList.remove('active');
        alert('Error saving categories: ' + error.message);
    }
}

// Skip setup (use default categories)
async function skipSetup() {
    const defaultCategories = {
        income: ['Salary', 'Other'],
        expense: ['Food & Dining', 'Transport', 'Shopping', 'Bills & Utilities', 'Other']
    };

    // Wait for Firebase to be ready
    await new Promise(resolve => {
        function checkFirebase() {
            if (window.auth && window.auth.currentUser && window.setDoc && window.doc && window.db) {
                resolve();
            } else {
                setTimeout(checkFirebase, 50);
            }
        }
        checkFirebase();
    });

    document.getElementById('pageLoader').classList.add('active');

    try {
        const user = window.auth.currentUser;
        
        await window.setDoc(
            window.doc(window.db, 'users', user.uid, 'settings', 'categories'),
            {
                income: defaultCategories.income,
                expense: defaultCategories.expense,
                setupCompleted: true,
                createdAt: window.serverTimestamp()
            }
        );

        window.location.href = 'index.html';
    } catch (error) {
        document.getElementById('pageLoader').classList.remove('active');
        alert('Error: ' + error.message);
    }
}

// Allow Enter key to add custom category
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('customIncome').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addCustomCategory('income');
    });
    
    document.getElementById('customExpense').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addCustomCategory('expense');
    });
});

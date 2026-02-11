// Enhanced Category Setup Logic with Color Support

let selectedCategories = {
    income: [],
    expense: []
};

// Default categories with colors
const defaultIncomeCategories = [
    { name: 'Salary', color: '#10b981' },
    { name: 'Freelance', color: '#3b82f6' },
    { name: 'Business', color: '#8b5cf6' },
    { name: 'Investment', color: '#06b6d4' },
    { name: 'Gift', color: '#ec4899' },
    { name: 'Other', color: '#6366f1' }
];

const defaultExpenseCategories = [
    { name: 'Food & Dining', color: '#ef4444' },
    { name: 'Transport', color: '#f97316' },
    { name: 'Shopping', color: '#ec4899' },
    { name: 'Bills & Utilities', color: '#f59e0b' },
    { name: 'Entertainment', color: '#a855f7' },
    { name: 'Healthcare', color: '#14b8a6' },
    { name: 'Education', color: '#3b82f6' },
    { name: 'Travel', color: '#06b6d4' },
    { name: 'Other', color: '#6b7280' }
];

// Initialize pills on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeCategoryPills();
});

function initializeCategoryPills() {
    renderCategoryPills('income', defaultIncomeCategories);
    renderCategoryPills('expense', defaultExpenseCategories);
}

function renderCategoryPills(type, categories) {
    const container = document.getElementById(type + 'Pills');
    container.innerHTML = '';
    
    categories.forEach(cat => {
        const pill = createCategoryPill(type, cat.name, cat.color);
        container.appendChild(pill);
    });
}

function createCategoryPill(type, name, color) {
    const pill = document.createElement('div');
    pill.className = 'category-pill';
    pill.style.borderColor = color;
    pill.innerHTML = `
        <div class="category-color-dot" style="background: ${color}"></div>
        <span>${name}</span>
    `;
    
    pill.onclick = function() {
        toggleCategory(this, type, name, color);
    };
    
    return pill;
}

// Toggle category selection
function toggleCategory(element, type, name, color) {
    if (element.classList.contains('selected')) {
        element.classList.remove('selected');
        element.style.background = 'var(--bg-secondary)';
        element.style.color = 'var(--text-primary)';
        
        selectedCategories[type] = selectedCategories[type].filter(c => c.name !== name);
    } else {
        element.classList.add('selected');
        element.style.background = color + '20';
        element.style.color = color;
        element.style.borderColor = color;
        
        if (!selectedCategories[type].find(c => c.name === name)) {
            selectedCategories[type].push({ name, color });
        }
    }
}

// Add custom category
function addCustomCategory(type) {
    const inputId = type === 'income' ? 'customIncome' : 'customExpense';
    const colorInputId = type === 'income' ? 'customIncomeColor' : 'customExpenseColor';
    
    const input = document.getElementById(inputId);
    const colorInput = document.getElementById(colorInputId);
    const categoryName = input.value.trim();
    const categoryColor = colorInput.value;

    if (!categoryName) {
        alert('Please enter a category name');
        return;
    }

    // Add pill to UI
    const pillsContainer = document.getElementById(type + 'Pills');
    const pill = createCategoryPill(type, categoryName, categoryColor);
    pill.classList.add('selected');
    pill.style.background = categoryColor + '20';
    pill.style.color = categoryColor;
    pill.style.borderColor = categoryColor;
    pillsContainer.appendChild(pill);

    // Add to selected categories
    if (!selectedCategories[type].find(c => c.name === categoryName)) {
        selectedCategories[type].push({ name: categoryName, color: categoryColor });
    }

    // Clear inputs
    input.value = '';
    colorInput.value = type === 'income' ? '#10b981' : '#FF6B6B';
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
        
        // Save to Firestore with colors
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
                income: defaultIncomeCategories,
                expense: defaultExpenseCategories,
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
    const customIncomeInput = document.getElementById('customIncome');
    const customExpenseInput = document.getElementById('customExpense');
    
    if (customIncomeInput) {
        customIncomeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addCustomCategory('income');
        });
    }
    
    if (customExpenseInput) {
        customExpenseInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addCustomCategory('expense');
        });
    }
});

// Export functions to window for HTML onclick handlers
window.toggleCategory = toggleCategory;
window.addCustomCategory = addCustomCategory;
window.saveCategories = saveCategories;
window.skipSetup = skipSetup;
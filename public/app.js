// Main Application Logic

// Global variables
let unsubscribe = null;
let allTransactions = [];
let userCategories = { income: [], expense: [] };
let currentPeriod = 'daily';
let spendingChart = null;

// Wait for Firebase to be ready
function waitForFirebase(callback) {
    if (window.auth && window.db && window.onAuthStateChanged && window.signOutFirebase) {
        callback();
    } else {
        setTimeout(() => waitForFirebase(callback), 100);
    }
}

// Initialize app when Firebase is ready
waitForFirebase(() => {
    window.onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            // Display user email
            document.getElementById('userEmail').textContent = user.email;
            
            // Load user categories
            await loadUserCategories(user.uid);
            
            // Set today's date as default
            setTodayDate();
            
            // Load transactions
            loadTransactions(user.uid);
            
            // Update category dropdown when type changes
            document.getElementById('typeInput').addEventListener('change', updateCategoryDropdown);
            updateCategoryDropdown();
        }
    });
});

// Set today's date in the date input
function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('dateInput').value = today;
}

// Load user categories from Firestore
async function loadUserCategories(userId) {
    try {
        const categoriesDoc = await window.getDoc(
            window.doc(window.db, 'users', userId, 'settings', 'categories')
        );
        
        if (categoriesDoc.exists()) {
            userCategories = categoriesDoc.data();
        }
        
        updateCategoryDropdown();
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// Update category dropdown based on selected type
function updateCategoryDropdown() {
    const type = document.getElementById('typeInput').value;
    const categorySelect = document.getElementById('categoryInput');
    
    categorySelect.innerHTML = '<option value="">Select Category</option>';
    
    const categories = userCategories[type] || [];
    categories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categorySelect.appendChild(option);
    });
}

// Switch between tabs (Daily/Monthly/Yearly)
function switchTab(period) {
    currentPeriod = period;
    
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update filter info
    updateFilterInfo();
    
    // Re-render with filtered data
    renderTransactions();
    updateStats();
    updateChart();
}

// Update filter info text
function updateFilterInfo() {
    const filterInfo = document.getElementById('filterInfo');
    const now = new Date();
    
    if (currentPeriod === 'daily') {
        filterInfo.textContent = `Today: ${now.toLocaleDateString('en-IN')}`;
    } else if (currentPeriod === 'monthly') {
        const monthName = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
        filterInfo.textContent = `This Month: ${monthName}`;
    } else {
        filterInfo.textContent = `This Year: ${now.getFullYear()}`;
    }
}

// Filter transactions based on current period
function getFilteredTransactions() {
    const now = new Date();
    
    return allTransactions.filter(t => {
        if (!t.date || !t.date.toDate) return false;
        
        const transactionDate = t.date.toDate();
        
        if (currentPeriod === 'daily') {
            // Same day
            return transactionDate.toDateString() === now.toDateString();
        } else if (currentPeriod === 'monthly') {
            // Same month and year
            return transactionDate.getMonth() === now.getMonth() &&
                   transactionDate.getFullYear() === now.getFullYear();
        } else {
            // Same year
            return transactionDate.getFullYear() === now.getFullYear();
        }
    });
}

// Format currency in Indian Rupees
function formatCurrency(amount) {
    return '₹' + amount.toLocaleString('en-IN', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

// Sign Out function
async function signOut() {
    if (!confirm('Are you sure you want to sign out?')) {
        return;
    }

    const btn = event.target;
    
    try {
        console.log('=== Sign Out Started ===');
        console.log('window.firebaseReady exists:', !!window.firebaseReady);
        console.log('window.firebaseInitialized:', window.firebaseInitialized);
        console.log('window.signOutFirebase type:', typeof window.signOutFirebase);
        console.log('window.auth exists:', !!window.auth);
        
        btn.classList.add('btn-loading');
        btn.textContent = '';

        // Wait for Firebase with timeout
        console.log('Waiting for Firebase to be ready...');
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3000));
        
        if (window.firebaseReady) {
            await Promise.race([window.firebaseReady, timeoutPromise]);
        }
        
        console.log('Firebase check complete');
        console.log('Window.signOutFirebase after wait:', typeof window.signOutFirebase);
        
        // Verify firebase is available
        if (!window.auth) {
            throw new Error('Firebase auth not initialized');
        }
        
        if (!window.signOutFirebase || typeof window.signOutFirebase !== 'function') {
            console.error('signOutFirebase not available:', {
                exists: !!window.signOutFirebase,
                type: typeof window.signOutFirebase,
                isFunction: typeof window.signOutFirebase === 'function'
            });
            throw new Error('signOutFirebase function not available');
        }

        if (unsubscribe) {
            console.log('Unsubscribing from real-time listeners...');
            unsubscribe();
        }
        
        console.log('Calling window.signOutFirebase(window.auth)...');
        await window.signOutFirebase(window.auth);
        console.log('✓ Sign out successful');
    } catch (error) {
        console.error('❌ Sign out error:', error);
        if (btn) {
            btn.classList.remove('btn-loading');
            btn.textContent = 'Sign Out';
        }
        alert('Error signing out: ' + error.message);
    }
}

// Add Transaction function
async function addTransaction() {
    // Wait for Firebase to be ready
    await new Promise(resolve => {
        function checkFirebase() {
            if (window.auth && window.auth.currentUser && window.addDoc && window.collection && window.db) {
                resolve();
            } else {
                setTimeout(checkFirebase, 50);
            }
        }
        checkFirebase();
    });

    const type = document.getElementById('typeInput').value;
    const amount = parseFloat(document.getElementById('amountInput').value);
    const category = document.getElementById('categoryInput').value;
    const dateValue = document.getElementById('dateInput').value;
    const description = document.getElementById('descInput').value.trim();

    // Validation
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount greater than 0');
        return;
    }

    if (!category) {
        alert('Please select a category');
        return;
    }

    if (!dateValue) {
        alert('Please select a date');
        return;
    }

    const btn = event.target;
    const originalText = btn.textContent;
    btn.classList.add('btn-loading');
    btn.textContent = '';

    try {
        const user = window.auth.currentUser;
        
        // Convert date string to timestamp
        const selectedDate = new Date(dateValue + 'T00:00:00');
        
        await window.addDoc(
            window.collection(window.db, 'users', user.uid, 'transactions'),
            {
                type: type,
                amount: amount,
                category: category,
                description: description,
                date: window.serverTimestamp(),
                selectedDate: selectedDate
            }
        );

        // Clear form
        document.getElementById('amountInput').value = '';
        document.getElementById('categoryInput').value = '';
        document.getElementById('descInput').value = '';
        setTodayDate();

        btn.classList.remove('btn-loading');
        btn.textContent = originalText;

    } catch (error) {
        btn.classList.remove('btn-loading');
        btn.textContent = originalText;
        alert('Error adding transaction: ' + error.message);
    }
}

// Load Transactions with real-time updates
function loadTransactions(userId) {
    const q = window.query(
        window.collection(window.db, 'users', userId, 'transactions'),
        window.orderBy('date', 'desc')
    );

    unsubscribe = window.onSnapshot(q, (snapshot) => {
        allTransactions = [];
        
        snapshot.forEach((doc) => {
            const data = doc.data();
            allTransactions.push({
                id: doc.id,
                ...data,
                // Use selectedDate if available, otherwise use date
                date: data.selectedDate || data.date
            });
        });

        updateFilterInfo();
        renderTransactions();
        updateStats();
        updateChart();
    });
}

// Render Transactions to the page
function renderTransactions() {
    const list = document.getElementById('transactionsList');
    const filtered = getFilteredTransactions();
    
    if (filtered.length === 0) {
        list.innerHTML = `<div class="loading">No transactions for this period. Add your first transaction above!</div>`;
        return;
    }

    list.innerHTML = filtered.map(transaction => {
        const date = transaction.date && transaction.date.toDate ? 
            transaction.date.toDate().toLocaleDateString('en-IN') : 'N/A';
            
        return `
            <div class="transaction-item ${transaction.type}">
                <div class="transaction-info">
                    <div class="transaction-category">${transaction.category}</div>
                    <div class="transaction-desc">${transaction.description || 'No description'} • ${date}</div>
                </div>
                <div class="transaction-amount ${transaction.type}">
                    ${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}
                </div>
                <button class="delete-btn" onclick="deleteTransaction('${transaction.id}')">
                    Delete
                </button>
            </div>
        `;
    }).join('');
}

// Update Stats (Income, Expense, Balance)
function updateStats() {
    const filtered = getFilteredTransactions();
    
    const totalIncome = filtered
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);

    const totalExpense = filtered
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpense;

    document.getElementById('totalIncome').textContent = formatCurrency(totalIncome);
    document.getElementById('totalExpense').textContent = formatCurrency(totalExpense);
    document.getElementById('balance').textContent = formatCurrency(balance);
}

// Update Chart
function updateChart() {
    const filtered = getFilteredTransactions();
    
    // Group by category
    const expensesByCategory = {};
    filtered
        .filter(t => t.type === 'expense')
        .forEach(t => {
            expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
        });

    const categories = Object.keys(expensesByCategory);
    const amounts = Object.values(expensesByCategory);

    const ctx = document.getElementById('spendingChart').getContext('2d');

    if (spendingChart) {
        spendingChart.destroy();
    }

    spendingChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: categories,
            datasets: [{
                data: amounts,
                backgroundColor: [
                    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
                    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
                    '#F8B4B4', '#A8E6CF'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary'),
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                title: {
                    display: true,
                    text: 'Expenses by Category',
                    color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary'),
                    font: {
                        size: 16,
                        weight: '600'
                    }
                }
            }
        }
    });
}

// Delete Transaction function
async function deleteTransaction(transactionId) {
    if (!confirm('Are you sure you want to delete this transaction?')) {
        return;
    }

    // Wait for Firebase to be ready
    await new Promise(resolve => {
        function checkFirebase() {
            if (window.auth && window.auth.currentUser && window.deleteDoc && window.doc && window.db) {
                resolve();
            } else {
                setTimeout(checkFirebase, 50);
            }
        }
        checkFirebase();
    });

    const btn = event.target;
    const originalText = btn.textContent;
    btn.classList.add('btn-loading');
    btn.textContent = '';

    try {
        const user = window.auth.currentUser;
        await window.deleteDoc(
            window.doc(window.db, 'users', user.uid, 'transactions', transactionId)
        );
    } catch (error) {
        btn.classList.remove('btn-loading');
        btn.textContent = originalText;
        alert('Error deleting transaction: ' + error.message);
    }
}

// Categories Management Modal
function openCategoriesModal() {
    document.getElementById('categoriesModal').classList.add('active');
    loadCategoriesInModal();
}

function closeCategoriesModal() {
    document.getElementById('categoriesModal').classList.remove('active');
}

function loadCategoriesInModal() {
    // Load income categories
    const incomeList = document.getElementById('incomeCategoriesList');
    incomeList.innerHTML = userCategories.income.map(cat => `
        <div class="category-item">
            <span>${cat}</span>
            <button onclick="removeCategory('income', '${cat}')" class="remove-btn">×</button>
        </div>
    `).join('');
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

    
    // Load expense categories
    const expenseList = document.getElementById('expenseCategoriesList');
    expenseList.innerHTML = userCategories.expense.map(cat => `
        <div class="category-item">
            <span>${cat}</span>
            <button onclick="removeCategory('expense', '${cat}')" class="remove-btn">×</button>
        </div>
    `).join('');
}

async function addCategory(type) {
    const inputId = type === 'income' ? 'newIncomeCategory' : 'newExpenseCategory';
    const input = document.getElementById(inputId);
    const category = input.value.trim();

    if (!category) {
        alert('Please enter a category name');
        return;
    }

    if (userCategories[type].includes(category)) {
        alert('Category already exists');
        return;
    }

    try {
        const user = window.auth.currentUser;
        userCategories[type].push(category);

        await window.setDoc(
            window.doc(window.db, 'users', user.uid, 'settings', 'categories'),
            userCategories
        );

        input.value = '';
        loadCategoriesInModal();
        updateCategoryDropdown();
    } catch (error) {
        alert('Error adding category: ' + error.message);
    }
}

async function removeCategory(type, category) {
    if (!confirm(`Remove "${category}" from ${type} categories?`)) {
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

    try {
        const user = window.auth.currentUser;
        userCategories[type] = userCategories[type].filter(c => c !== category);

        await window.setDoc(
            window.doc(window.db, 'users', user.uid, 'settings', 'categories'),
            userCategories
        );

        loadCategoriesInModal();
        updateCategoryDropdown();
    } catch (error) {
        alert('Error removing category: ' + error.message);
    }
}

// Expose functions to global scope for HTML onclick handlers
window.switchTab = switchTab;
window.openCategoriesModal = openCategoriesModal;
window.closeCategoriesModal = closeCategoriesModal;
window.signOut = signOut;
window.addTransaction = addTransaction;
window.deleteTransaction = deleteTransaction;
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.updateCategoryDropdown = updateCategoryDropdown;
window.loadCategoriesInModal = loadCategoriesInModal;


// Enhanced Finance Tracker - Main Application Logic

let currentUser = null;
let currentPeriod = 'daily';
let selectedDate = new Date();
let categories = { income: [], expense: [] };
let transactions = [];
let pendingAmounts = [];
let chart = null;
let editingTransactionId = null;

// Haptic feedback for mobile devices
function triggerHaptic() {
    if ('vibrate' in navigator) {
        navigator.vibrate(50); // 50ms vibration
    }
}

// Visual feedback for button
function showButtonSuccess(buttonId, duration = 2000) {
    const btn = document.getElementById(buttonId);
    const textSpan = document.getElementById('addBtnText');
    const successSpan = document.getElementById('addBtnSuccess');
    
    if (textSpan && successSpan) {
        textSpan.classList.add('hidden');
        successSpan.classList.remove('hidden');
        btn.style.background = 'var(--income)';
        
        triggerHaptic();
        
        setTimeout(() => {
            textSpan.classList.remove('hidden');
            successSpan.classList.add('hidden');
            btn.style.background = '';
        }, duration);
    }
}

// Generate a random color for new categories
function generateRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 60%)`;
}

// Get category type (income or expense)
function getCategoryType(categoryName) {
    if (categories.income.find(cat => (typeof cat === 'string' ? cat : cat.name) === categoryName)) {
        return 'income';
    }
    if (categories.expense.find(cat => (typeof cat === 'string' ? cat : cat.name) === categoryName)) {
        return 'expense';
    }
    return null;
}

// Wait for Firebase and user authentication
window.firebaseReady.then(async () => {
    window.onAuthStateChanged(window.auth, async (user) => {
        if (user) {
            currentUser = user;
            document.getElementById('userEmail').textContent = user.email;
            
            // Set default dates
            const today = new Date();
            document.getElementById('dateInput').valueAsDate = today;
            document.getElementById('dailyDate').valueAsDate = today;
            document.getElementById('monthlyDate').value = today.toISOString().slice(0, 7);
            document.getElementById('yearlyDate').value = today.getFullYear();
            
            // Load categories
            await loadCategories();
            
            // Load pending amounts
            loadPendingAmounts();
            
            // Load transactions
            loadTransactions();
            
            // Update date selector visibility
            updateDateSelectorVisibility();
        }
    });
});

// ===============================
// CATEGORY MANAGEMENT
// ===============================

async function loadCategories() {
    try {
        const categoriesDoc = await window.getDoc(
            window.doc(window.db, 'users', currentUser.uid, 'settings', 'categories')
        );
        
        if (categoriesDoc.exists()) {
            const data = categoriesDoc.data();
            categories = {
                income: data.income || [],
                expense: data.expense || []
            };
        } else {
            // Default categories with colors
            categories = {
                income: [
                    { name: 'Salary', color: '#10b981' },
                    { name: 'Freelance', color: '#3b82f6' },
                    { name: 'Business', color: '#8b5cf6' },
                    { name: 'Investment', color: '#06b6d4' },
                    { name: 'Other', color: '#6366f1' }
                ],
                expense: [
                    { name: 'Food & Dining', color: '#ef4444' },
                    { name: 'Transport', color: '#f97316' },
                    { name: 'Shopping', color: '#ec4899' },
                    { name: 'Bills & Utilities', color: '#f59e0b' },
                    { name: 'Entertainment', color: '#a855f7' },
                    { name: 'Healthcare', color: '#14b8a6' },
                    { name: 'Education', color: '#3b82f6' },
                    { name: 'Travel', color: '#06b6d4' },
                    { name: 'Other', color: '#6b7280' }
                ]
            };
            await saveCategories();
        }
        
        updateCategoryOptions();
        updateEditCategoryOptions();
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

async function saveCategories() {
    try {
        await window.setDoc(
            window.doc(window.db, 'users', currentUser.uid, 'settings', 'categories'),
            {
                income: categories.income,
                expense: categories.expense,
                setupCompleted: true,
                updatedAt: window.serverTimestamp()
            }
        );
    } catch (error) {
        console.error('Error saving categories:', error);
        alert('Error saving categories');
    }
}

function updateCategoryOptions() {
    const categorySelect = document.getElementById('categoryInput');
    categorySelect.innerHTML = '<option value="">Select Category</option>';
    
    // Add income categories
    const incomeGroup = document.createElement('optgroup');
    incomeGroup.label = 'Income';
    categories.income.forEach(cat => {
        const option = document.createElement('option');
        const catName = typeof cat === 'string' ? cat : cat.name;
        option.value = catName;
        option.textContent = catName;
        incomeGroup.appendChild(option);
    });
    categorySelect.appendChild(incomeGroup);
    
    // Add expense categories
    const expenseGroup = document.createElement('optgroup');
    expenseGroup.label = 'Expense';
    categories.expense.forEach(cat => {
        const option = document.createElement('option');
        const catName = typeof cat === 'string' ? cat : cat.name;
        option.value = catName;
        option.textContent = catName;
        expenseGroup.appendChild(option);
    });
    categorySelect.appendChild(expenseGroup);
}

function updateEditCategoryOptions() {
    const categorySelect = document.getElementById('editCategoryInput');
    categorySelect.innerHTML = '<option value="">Select Category</option>';
    
    // Add income categories
    const incomeGroup = document.createElement('optgroup');
    incomeGroup.label = 'Income';
    categories.income.forEach(cat => {
        const option = document.createElement('option');
        const catName = typeof cat === 'string' ? cat : cat.name;
        option.value = catName;
        option.textContent = catName;
        incomeGroup.appendChild(option);
    });
    categorySelect.appendChild(incomeGroup);
    
    // Add expense categories
    const expenseGroup = document.createElement('optgroup');
    expenseGroup.label = 'Expense';
    categories.expense.forEach(cat => {
        const option = document.createElement('option');
        const catName = typeof cat === 'string' ? cat : cat.name;
        option.value = catName;
        option.textContent = catName;
        expenseGroup.appendChild(option);
    });
    categorySelect.appendChild(expenseGroup);
}

function openCategoriesModal() {
    document.getElementById('categoriesModal').classList.add('active');
    renderCategoriesLists();
}

function closeCategoriesModal() {
    document.getElementById('categoriesModal').classList.remove('active');
    updateCategoryOptions();
    updateEditCategoryOptions();
    updateChart();
}

function renderCategoriesLists() {
    // Render income categories
    const incomeList = document.getElementById('incomeCategoriesList');
    incomeList.innerHTML = '';
    
    categories.income.forEach((cat, index) => {
        const catName = typeof cat === 'string' ? cat : cat.name;
        const catColor = typeof cat === 'string' ? generateRandomColor() : cat.color;
        
        const item = document.createElement('div');
        item.className = 'category-item';
        item.innerHTML = `
            <div class="category-color-dot" style="background: ${catColor}"></div>
            <input type="color" value="${catColor}" onchange="updateCategoryColor('income', ${index}, this.value)" 
                   style="width: 50px; height: 36px; border-radius: 8px; cursor: pointer; border: 2px solid var(--border);">
            <span class="category-name">${catName}</span>
            <button class="category-remove" onclick="removeCategory('income', ${index})">Remove</button>
        `;
        incomeList.appendChild(item);
    });
    
    // Render expense categories
    const expenseList = document.getElementById('expenseCategoriesList');
    expenseList.innerHTML = '';
    
    categories.expense.forEach((cat, index) => {
        const catName = typeof cat === 'string' ? cat : cat.name;
        const catColor = typeof cat === 'string' ? generateRandomColor() : cat.color;
        
        const item = document.createElement('div');
        item.className = 'category-item';
        item.innerHTML = `
            <div class="category-color-dot" style="background: ${catColor}"></div>
            <input type="color" value="${catColor}" onchange="updateCategoryColor('expense', ${index}, this.value)"
                   style="width: 50px; height: 36px; border-radius: 8px; cursor: pointer; border: 2px solid var(--border);">
            <span class="category-name">${catName}</span>
            <button class="category-remove" onclick="removeCategory('expense', ${index})">Remove</button>
        `;
        expenseList.appendChild(item);
    });
}

function updateCategoryColor(type, index, color) {
    if (typeof categories[type][index] === 'string') {
        categories[type][index] = {
            name: categories[type][index],
            color: color
        };
    } else {
        categories[type][index].color = color;
    }
    saveCategories();
    renderCategoriesLists();
}

async function addCategory(type) {
    const inputId = type === 'income' ? 'newIncomeCategory' : 'newExpenseCategory';
    const colorInputId = type === 'income' ? 'newIncomeCategoryColor' : 'newExpenseCategoryColor';
    const input = document.getElementById(inputId);
    const colorInput = document.getElementById(colorInputId);
    const categoryName = input.value.trim();
    const categoryColor = colorInput.value;
    
    if (!categoryName) {
        alert('Please enter a category name');
        return;
    }
    
    categories[type].push({
        name: categoryName,
        color: categoryColor
    });
    
    await saveCategories();
    renderCategoriesLists();
    updateCategoryOptions();
    updateEditCategoryOptions();
    input.value = '';
    colorInput.value = type === 'income' ? '#10b981' : '#FF6B6B';
}

async function removeCategory(type, index) {
    if (confirm('Remove this category?')) {
        categories[type].splice(index, 1);
        await saveCategories();
        renderCategoriesLists();
        updateCategoryOptions();
        updateEditCategoryOptions();
    }
}

function getCategoryColor(type, categoryName) {
    const categoryList = categories[type] || [];
    const category = categoryList.find(cat => 
        (typeof cat === 'string' ? cat : cat.name) === categoryName
    );
    
    if (category) {
        return typeof category === 'string' ? generateRandomColor() : category.color;
    }
    
    return type === 'income' ? '#10b981' : '#FF6B6B';
}

// ===============================
// PENDING AMOUNTS
// ===============================

function loadPendingAmounts() {
    const q = window.query(
        window.collection(window.db, 'users', currentUser.uid, 'pending'),
        window.orderBy('createdAt', 'desc')
    );
    
    window.onSnapshot(q, (snapshot) => {
        pendingAmounts = [];
        const pendingList = document.getElementById('pendingList');
        pendingList.innerHTML = '';
        
        if (snapshot.empty) {
            pendingList.innerHTML = '<div class="loading">No pending amounts</div>';
            updateStats();
            return;
        }
        
        snapshot.forEach(doc => {
            const data = doc.data();
            pendingAmounts.push({ id: doc.id, ...data });
            
            const item = document.createElement('div');
            item.className = 'pending-item';
            item.innerHTML = `
                <input type="checkbox" class="pending-checkbox" onchange="clearPendingAmount('${doc.id}')">
                <div class="pending-info">
                    <div class="pending-name">${data.name}</div>
                    <div class="pending-amount">₹${data.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
            `;
            pendingList.appendChild(item);
        });
        
        updateStats();
    });
}

async function addPendingAmount() {
    const nameInput = document.getElementById('pendingNameInput');
    const amountInput = document.getElementById('pendingAmountInput');
    
    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    
    if (!name) {
        alert('Please enter a person\'s name');
        return;
    }
    
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }
    
    try {
        await window.addDoc(
            window.collection(window.db, 'users', currentUser.uid, 'pending'),
            {
                name: name,
                amount: amount,
                createdAt: window.serverTimestamp()
            }
        );
        
        nameInput.value = '';
        amountInput.value = '';
        triggerHaptic();
    } catch (error) {
        console.error('Error adding pending amount:', error);
        alert('Error adding pending amount');
    }
}

async function clearPendingAmount(id) {
    try {
        await window.deleteDoc(
            window.doc(window.db, 'users', currentUser.uid, 'pending', id)
        );
        triggerHaptic();
    } catch (error) {
        console.error('Error clearing pending amount:', error);
        alert('Error clearing pending amount');
    }
}

// ===============================
// TRANSACTIONS
// ===============================

function loadTransactions() {
    const q = window.query(
        window.collection(window.db, 'users', currentUser.uid, 'transactions'),
        window.orderBy('selectedDate', 'desc')
    );
    
    window.onSnapshot(q, (snapshot) => {
        transactions = [];
        snapshot.forEach(doc => {
            transactions.push({ id: doc.id, ...doc.data() });
        });
        
        filterAndDisplayTransactions();
    });
}

async function addTransaction() {
    const category = document.getElementById('categoryInput').value;
    const amount = parseFloat(document.getElementById('amountInput').value);
    const selectedDateStr = document.getElementById('dateInput').value;
    const description = document.getElementById('descInput').value.trim();
    
    if (!category) {
        alert('Please select a category');
        return;
    }
    
    if (!amount || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }
    
    if (!selectedDateStr) {
        alert('Please select a date');
        return;
    }
    
    // Auto-detect type from category
    const type = getCategoryType(category);
    if (!type) {
        alert('Invalid category selected');
        return;
    }
    
    try {
        await window.addDoc(
            window.collection(window.db, 'users', currentUser.uid, 'transactions'),
            {
                type: type,
                amount: amount,
                category: category,
                description: description,
                selectedDate: new Date(selectedDateStr),
                createdAt: window.serverTimestamp()
            }
        );
        
        // Clear inputs
        document.getElementById('amountInput').value = '';
        document.getElementById('categoryInput').value = '';
        document.getElementById('descInput').value = '';
        document.getElementById('dateInput').valueAsDate = new Date();
        
        // Show success feedback
        showButtonSuccess('addTransactionBtn');
    } catch (error) {
        console.error('Error adding transaction:', error);
        alert('Error adding transaction');
    }
}

async function deleteTransaction(id) {
    if (confirm('Delete this transaction?')) {
        try {
            await window.deleteDoc(
                window.doc(window.db, 'users', currentUser.uid, 'transactions', id)
            );
            triggerHaptic();
        } catch (error) {
            console.error('Error deleting transaction:', error);
            alert('Error deleting transaction');
        }
    }
}

// Edit transaction
function openEditModal(id) {
    editingTransactionId = id;
    const transaction = transactions.find(t => t.id === id);
    
    if (!transaction) return;
    
    const txDate = transaction.selectedDate.toDate ? transaction.selectedDate.toDate() : new Date(transaction.selectedDate);
    
    document.getElementById('editDateInput').valueAsDate = txDate;
    document.getElementById('editCategoryInput').value = transaction.category;
    document.getElementById('editAmountInput').value = transaction.amount;
    document.getElementById('editDescInput').value = transaction.description || '';
    
    document.getElementById('editModal').classList.add('active');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('active');
    editingTransactionId = null;
}

async function saveEditTransaction() {
    if (!editingTransactionId) return;
    
    const category = document.getElementById('editCategoryInput').value;
    const amount = parseFloat(document.getElementById('editAmountInput').value);
    const selectedDateStr = document.getElementById('editDateInput').value;
    const description = document.getElementById('editDescInput').value.trim();
    
    if (!category || !amount || !selectedDateStr) {
        alert('Please fill all required fields');
        return;
    }
    
    const type = getCategoryType(category);
    if (!type) {
        alert('Invalid category selected');
        return;
    }
    
    try {
        await window.setDoc(
            window.doc(window.db, 'users', currentUser.uid, 'transactions', editingTransactionId),
            {
                type: type,
                amount: amount,
                category: category,
                description: description,
                selectedDate: new Date(selectedDateStr),
                updatedAt: window.serverTimestamp()
            },
            { merge: true }
        );
        
        closeEditModal();
        triggerHaptic();
    } catch (error) {
        console.error('Error updating transaction:', error);
        alert('Error updating transaction');
    }
}

// ===============================
// PERIOD FILTERING
// ===============================

function switchTab(period) {
    currentPeriod = period;
    
    // Update active tab
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    
    updateDateSelectorVisibility();
    applyPeriodFilter();
}

function updateDateSelectorVisibility() {
    document.getElementById('dailySelector').classList.toggle('hidden', currentPeriod !== 'daily');
    document.getElementById('monthlySelector').classList.toggle('hidden', currentPeriod !== 'monthly');
    document.getElementById('yearlySelector').classList.toggle('hidden', currentPeriod !== 'yearly');
}

function applyPeriodFilter() {
    if (currentPeriod === 'daily') {
        const dateStr = document.getElementById('dailyDate').value;
        selectedDate = dateStr ? new Date(dateStr) : new Date();
    } else if (currentPeriod === 'monthly') {
        const dateStr = document.getElementById('monthlyDate').value;
        if (dateStr) {
            const [year, month] = dateStr.split('-');
            selectedDate = new Date(year, month - 1, 1);
        } else {
            selectedDate = new Date();
        }
    } else if (currentPeriod === 'yearly') {
        const year = document.getElementById('yearlyDate').value;
        selectedDate = year ? new Date(year, 0, 1) : new Date();
    }
    
    filterAndDisplayTransactions();
}

function isInPeriod(transactionDate) {
    const txDate = transactionDate.toDate ? transactionDate.toDate() : new Date(transactionDate);
    
    if (currentPeriod === 'daily') {
        return txDate.toDateString() === selectedDate.toDateString();
    } else if (currentPeriod === 'monthly') {
        return txDate.getMonth() === selectedDate.getMonth() && 
               txDate.getFullYear() === selectedDate.getFullYear();
    } else if (currentPeriod === 'yearly') {
        return txDate.getFullYear() === selectedDate.getFullYear();
    }
    return false;
}

function filterAndDisplayTransactions() {
    const filteredTransactions = transactions.filter(tx => isInPeriod(tx.selectedDate));
    
    displayTransactions(filteredTransactions);
    updateStats(filteredTransactions);
    updateChart(filteredTransactions);
    updateFilterInfo();
}

function displayTransactions(filteredTransactions) {
    const list = document.getElementById('transactionsList');
    
    if (filteredTransactions.length === 0) {
        list.innerHTML = '<div class="loading">No transactions for this period</div>';
        return;
    }
    
    list.innerHTML = '';
    
    filteredTransactions.forEach(tx => {
        const txDate = tx.selectedDate.toDate ? tx.selectedDate.toDate() : new Date(tx.selectedDate);
        const categoryColor = getCategoryColor(tx.type, tx.category);
        
        const div = document.createElement('div');
        div.className = `transaction ${tx.type}`;
        div.innerHTML = `
            <div class="transaction-info">
                <div class="transaction-category" style="background: ${categoryColor}20; color: ${categoryColor}; border: 1px solid ${categoryColor}40;">
                    ${tx.category}
                </div>
                ${tx.description ? `<div class="transaction-description">${tx.description}</div>` : ''}
                <div class="transaction-date">${txDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
            </div>
            <div class="transaction-amount">${tx.type === 'income' ? '+' : '-'}₹${tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div class="transaction-actions">
                <button class="transaction-edit" onclick="openEditModal('${tx.id}')">Edit</button>
                <button class="transaction-delete" onclick="deleteTransaction('${tx.id}')">Delete</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function updateFilterInfo() {
    const info = document.getElementById('filterInfo');
    
    if (currentPeriod === 'daily') {
        info.textContent = 'Showing: ' + selectedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    } else if (currentPeriod === 'monthly') {
        info.textContent = 'Showing: ' + selectedDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    } else {
        info.textContent = 'Showing: ' + selectedDate.getFullYear();
    }
}

// ===============================
// STATS AND CHART
// ===============================

function updateStats(filteredTransactions = null) {
    const txList = filteredTransactions || transactions.filter(tx => isInPeriod(tx.selectedDate));
    
    const income = txList.filter(tx => tx.type === 'income').reduce((sum, tx) => sum + tx.amount, 0);
    const expense = txList.filter(tx => tx.type === 'expense').reduce((sum, tx) => sum + tx.amount, 0);
    const balance = income - expense;
    
    const totalPending = pendingAmounts.reduce((sum, p) => sum + p.amount, 0);
    const presentAmount = balance - totalPending;
    
    document.getElementById('totalIncome').textContent = `₹${income.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('totalExpense').textContent = `₹${expense.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('balance').textContent = `₹${presentAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('totalPending').textContent = `₹${totalPending.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function updateChart(filteredTransactions = null) {
    const txList = filteredTransactions || transactions.filter(tx => isInPeriod(tx.selectedDate));
    const expenses = txList.filter(tx => tx.type === 'expense');
    
    // Group by category
    const categoryTotals = {};
    const categoryColors = {};
    
    expenses.forEach(tx => {
        if (!categoryTotals[tx.category]) {
            categoryTotals[tx.category] = 0;
            categoryColors[tx.category] = getCategoryColor('expense', tx.category);
        }
        categoryTotals[tx.category] += tx.amount;
    });
    
    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    const colors = Object.values(categoryColors);
    
    // Destroy existing chart
    if (chart) {
        chart.destroy();
        chart = null;
    }
    
    const chartContainer = document.querySelector('.chart-container');
    
    if (labels.length === 0) {
        chartContainer.innerHTML = '<div class="loading">No expenses to display</div>';
        return;
    }
    
    // Recreate canvas
    chartContainer.innerHTML = '<canvas id="spendingChart"></canvas>';
    const ctx = document.getElementById('spendingChart').getContext('2d');
    
    chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 0,
                hoverBorderWidth: 4,
                hoverBorderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        padding: 20,
                        font: {
                            size: 13,
                            family: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Inter", sans-serif'
                        },
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim(),
                    titleColor: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim(),
                    bodyColor: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
                    borderColor: getComputedStyle(document.documentElement).getPropertyValue('--border').trim(),
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            
                            let periodText = '';
                            if (currentPeriod === 'daily') {
                                periodText = selectedDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
                            } else if (currentPeriod === 'monthly') {
                                periodText = selectedDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
                            } else {
                                periodText = selectedDate.getFullYear().toString();
                            }
                            
                            return [
                                `${label}`,
                                `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                                `${percentage}% (${periodText})`
                            ];
                        }
                    }
                }
            },
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1000,
                easing: 'easeInOutQuart'
            },
            cutout: '65%',
            hover: {
                mode: 'nearest',
                intersect: true
            }
        }
    });
}

// Sign out function
async function signOut() {
    if (confirm('Are you sure you want to sign out?')) {
        try {
            await window.signOutFirebase(window.auth);
        } catch (error) {
            console.error('Sign out error:', error);
            alert('Error signing out');
        }
    }
}

// Export functions to window
window.addTransaction = addTransaction;
window.deleteTransaction = deleteTransaction;
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveEditTransaction = saveEditTransaction;
window.switchTab = switchTab;
window.applyPeriodFilter = applyPeriodFilter;
window.openCategoriesModal = openCategoriesModal;
window.closeCategoriesModal = closeCategoriesModal;
window.addCategory = addCategory;
window.removeCategory = removeCategory;
window.updateCategoryColor = updateCategoryColor;
window.addPendingAmount = addPendingAmount;
window.clearPendingAmount = clearPendingAmount;
window.signOut = signOut;
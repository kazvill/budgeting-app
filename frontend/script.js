document.addEventListener("DOMContentLoaded", () => {
  // Configuration - update this URL when deploying backend to Render
  const API_URL = ""; // Frontend-only mode; keep empty to avoid backend calls

  // DOM Elements
  const toggle = document.getElementById("incomeToggle");
  const taxToggle = document.getElementById("taxToggle");
  const hourlyFields = document.getElementById("hourlyFields");
  const annualFields = document.getElementById("annualFields");
  const resultContainer = document.getElementById("resultContainer");
  const labelHourly = document.getElementById("labelHourly");
  const labelAnnual = document.getElementById("labelAnnual");

  const hourlyRateInput = document.getElementById("hourlyRate");
  const hoursPerWeekInput = document.getElementById("hoursPerWeek");
  const annualSalaryInput = document.getElementById("annualSalary");
  const subNameInput = document.getElementById("subName");
  const subAmountInput = document.getElementById("subAmount");
  const addSubBtn = document.getElementById("addSubBtn");
  const subscriptionsList = document.getElementById("subscriptionsList");
  const subscriptionsSection = document.getElementById("subscriptionsSection");
  const subscriptionsTotal = document.getElementById("subscriptionsTotal");
  const currentBalanceInput = document.getElementById("currentBalance");
  const annualCostNameInput = document.getElementById("annualCostName");
  const annualCostAmountInput = document.getElementById("annualCostAmount");
  const addAnnualCostBtn = document.getElementById("addAnnualCostBtn");
  const annualCostsList = document.getElementById("annualCostsList");
  const annualCostsSection = document.getElementById("annualCostsSection");
  const annualCostsTotal = document.getElementById("annualCostsTotal");
  const projectionOptions = document.getElementById("projectionOptions");
  const projectionResult = document.getElementById("projectionResult");
  const projectionChartCanvas = document.getElementById("projectionChart");
  const exportPdfBtn = document.getElementById("exportPdfBtn");

  const subscriptions = [];
  const annualCosts = [];
  let selectedProjectionMonths = 3;
  let chartInstance = null;

  /**
   * Updates which input fields are visible based on toggle state
   */
  function updateView() {
    const isAnnual = toggle.checked;

    // Toggle field visibility
    hourlyFields.style.display = isAnnual ? "none" : "block";
    annualFields.style.display = isAnnual ? "block" : "none";

    // Update label highlighting
    labelHourly.classList.toggle("active", !isAnnual);
    labelAnnual.classList.toggle("active", isAnnual);

    // Recalculate with new mode
    calculateMonthlyIncome();
  }

  /**
   * Gets annual income based on input state
   */
  function getAnnualIncome() {
    const isAnnual = toggle.checked;

    if (isAnnual) {
      const annual = parseFloat(annualSalaryInput.value);
      if (annual > 0) return annual;
    } else {
      const rate = parseFloat(hourlyRateInput.value);
      const hours = parseFloat(hoursPerWeekInput.value);
      if (rate > 0 && hours > 0) {
        return rate * hours * 52;
      }
    }
    return null;
  }

  /**
   * Calculates income and tax locally (no API call)
   */
  function calculateLocally() {
    const annualIncome = getAnnualIncome();
    if (!annualIncome) return null;

    const grossMonthly = annualIncome / 12;
    let monthlyTax = 0;

    if (taxToggle.checked) {
      const taxAnnual = calculateAnnualTax(annualIncome);
      monthlyTax = taxAnnual / 12;
    }

    return {
      grossAnnual: annualIncome,
      grossMonthly,
      monthlyTax,
      netMonthly: grossMonthly - monthlyTax,
      taxEnabled: taxToggle.checked,
    };
  }

  /**
   * Calculates UK income tax + National Insurance (2025-2026)
   */
  function calculateAnnualTax(annualIncome) {
    const personalAllowance = 12570;
    const allowanceTaperStart = 100000;
    const basicRateLimit = 37700;
    const higherRateLimit = 125140;

    const niPrimaryThreshold = 12570;
    const niUpperEarningsLimit = 50270;
    const niMainRate = 0.08;
    const niUpperRate = 0.02;

    const allowanceReduction = Math.max(0, annualIncome - allowanceTaperStart) / 2;
    const adjustedAllowance = Math.max(0, personalAllowance - allowanceReduction);
    const taxableIncome = Math.max(0, annualIncome - adjustedAllowance);

    const basicTaxable = Math.min(taxableIncome, basicRateLimit);
    const higherTaxable = Math.min(
      Math.max(taxableIncome - basicRateLimit, 0),
      higherRateLimit - basicRateLimit
    );
    const additionalTaxable = Math.max(taxableIncome - higherRateLimit, 0);

    const incomeTax =
      basicTaxable * 0.2 + higherTaxable * 0.4 + additionalTaxable * 0.45;

    let nationalInsurance = 0;
    if (annualIncome > niPrimaryThreshold) {
      const mainBand = Math.min(annualIncome, niUpperEarningsLimit) - niPrimaryThreshold;
      const upperBand = Math.max(annualIncome - niUpperEarningsLimit, 0);
      nationalInsurance = mainBand * niMainRate + upperBand * niUpperRate;
    }

    return incomeTax + nationalInsurance;
  }

  /**
   * Calls the backend API to calculate income and tax
   */
  async function calculateViaAPI() {
    const isAnnual = toggle.checked;
    let body;

    if (isAnnual) {
      const annual = parseFloat(annualSalaryInput.value);
      if (!annual || annual <= 0) return null;
      body = { income_type: "annual", annual_salary: annual, tax_enabled: taxToggle.checked };
    } else {
      const rate = parseFloat(hourlyRateInput.value);
      const hours = parseFloat(hoursPerWeekInput.value);
      if (!rate || !hours || rate <= 0 || hours <= 0) return null;
      body = {
        income_type: "hourly",
        hourly_rate: rate,
        hours_per_week: hours,
        tax_enabled: taxToggle.checked,
      };
    }

    try {
      const response = await fetch(`${API_URL}/calculate-income`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("API Error:", error);
        return null;
      }

      const data = await response.json();
      if (!data || !data.gross_monthly_income) return null;
      return {
        grossAnnual: data.gross_annual_income,
        grossMonthly: data.gross_monthly_income,
        monthlyTax: data.estimated_monthly_tax,
        netMonthly: data.net_monthly_income,
        taxEnabled: data.tax_enabled,
      };
    } catch (err) {
      console.error("Network error:", err);
      return null;
    }
  }

  /**
   * Main calculation function - uses API if configured, otherwise local
   */
  async function calculateMonthlyIncome() {
    const localResult = calculateLocally();
    let result = localResult;

    if (API_URL) {
      const apiResult = await calculateViaAPI();
      if (apiResult) result = apiResult;
    }

    renderResult(result);
    renderProjection(result);
  }

  /**
   * Renders the result in the UI
   */
  function renderResult(result) {
    if (result && result.grossMonthly > 0) {
      const subscriptionsCost = getSubscriptionsTotal();
      const annualMonthlyEquivalent = getAnnualCostsMonthlyTotal();
      const disposable = result.netMonthly - subscriptionsCost - annualMonthlyEquivalent;
      const annualTotal = getAnnualCostsAnnualTotal();
      const taxLabel = result.taxEnabled ? "Estimated monthly tax" : "Estimated monthly tax (off)";

      resultContainer.innerHTML = `
        <div class="breakdown">
          <div class="breakdown-row">
            <span>Gross monthly income</span>
            <strong>\u00A3${formatCurrency(result.grossMonthly)}</strong>
          </div>
          <div class="breakdown-row">
            <span>${taxLabel}</span>
            <strong>\u00A3${formatCurrency(result.monthlyTax)}</strong>
          </div>
          <div class="breakdown-row">
            <span>Net monthly income</span>
            <strong>\u00A3${formatCurrency(result.netMonthly)}</strong>
          </div>
          <div class="breakdown-row">
            <span>Total subscriptions</span>
            <strong>\u00A3${formatCurrency(subscriptionsCost)}</strong>
          </div>
          <div class="breakdown-row">
            <span>Annual costs (monthly equivalent)</span>
            <strong>\u00A3${formatCurrency(annualMonthlyEquivalent)}</strong>
          </div>
          <div class="breakdown-row">
            <span>Annual costs (total)</span>
            <strong>\u00A3${formatCurrency(annualTotal)}</strong>
          </div>
          <div class="breakdown-row total">
            <span>Disposable income</span>
            <strong>\u00A3${formatCurrency(disposable)}</strong>
          </div>
        </div>
      `;
    } else {
      resultContainer.innerHTML = `
        <span class="result-empty">Enter your income details above</span>
      `;
    }
  }

  /**
   * Formats a number as currency with commas and 2 decimal places
   */
  function formatCurrency(value) {
    return value.toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function getSubscriptionsTotal() {
    return subscriptions.reduce((sum, sub) => sum + sub.amount, 0);
  }

  function getAnnualCostsAnnualTotal() {
    return annualCosts.reduce((sum, cost) => sum + cost.amount, 0);
  }

  function getAnnualCostsMonthlyTotal() {
    return getAnnualCostsAnnualTotal() / 12;
  }

  function renderSubscriptions() {
    if (subscriptions.length === 0) {
      subscriptionsSection.style.display = "none";
      subscriptionsList.innerHTML = "";
      subscriptionsTotal.textContent = "";
      return;
    }

    subscriptionsSection.style.display = "block";
    subscriptionsList.innerHTML = subscriptions
      .map(
        (sub) => `
          <li class="subscription-item">
            <span>${sub.name}</span>
            <div class="subscription-actions">
              <span>\u00A3${formatCurrency(sub.amount)}</span>
              <button class="remove-btn" data-id="${sub.id}" aria-label="Remove ${sub.name}">Remove</button>
            </div>
          </li>
        `
      )
      .join("");

    subscriptionsTotal.textContent = `Total subscriptions: \u00A3${formatCurrency(
      getSubscriptionsTotal()
    )}`;
  }

  function renderAnnualCosts() {
    if (annualCosts.length === 0) {
      annualCostsSection.style.display = "none";
      annualCostsList.innerHTML = "";
      annualCostsTotal.textContent = "";
      return;
    }

    annualCostsSection.style.display = "block";
    annualCostsList.innerHTML = annualCosts
      .map(
        (cost) => `
          <li class="subscription-item">
            <span>${cost.name}</span>
            <div class="subscription-actions">
              <span>\u00A3${formatCurrency(cost.amount)}</span>
              <button class="remove-btn" data-id="${cost.id}" data-type="annual" aria-label="Remove ${cost.name}">Remove</button>
            </div>
          </li>
        `
      )
      .join("");

    annualCostsTotal.textContent = `Annual total: \u00A3${formatCurrency(
      getAnnualCostsAnnualTotal()
    )} \u2022 Monthly equivalent: \u00A3${formatCurrency(getAnnualCostsMonthlyTotal())}`;
  }

  function addSubscription() {
    const name = subNameInput.value.trim();
    const amount = parseFloat(subAmountInput.value);

    if (!name || !amount || amount <= 0) return;

    subscriptions.push({
      id: Date.now().toString(),
      name,
      amount,
    });

    subNameInput.value = "";
    subAmountInput.value = "";
    renderSubscriptions();
    calculateMonthlyIncome();
  }

  function addAnnualCost() {
    const name = annualCostNameInput.value.trim();
    const amount = parseFloat(annualCostAmountInput.value);

    if (!name || !amount || amount <= 0) return;

    annualCosts.push({
      id: Date.now().toString(),
      name,
      amount,
    });

    annualCostNameInput.value = "";
    annualCostAmountInput.value = "";
    renderAnnualCosts();
    calculateMonthlyIncome();
  }

  function removeSubscription(id) {
    const index = subscriptions.findIndex((sub) => sub.id === id);
    if (index === -1) return;
    subscriptions.splice(index, 1);
    renderSubscriptions();
    calculateMonthlyIncome();
  }

  function removeAnnualCost(id) {
    const index = annualCosts.findIndex((cost) => cost.id === id);
    if (index === -1) return;
    annualCosts.splice(index, 1);
    renderAnnualCosts();
    calculateMonthlyIncome();
  }

  function getCurrentBalance() {
    const value = parseFloat(currentBalanceInput.value);
    if (!value || value < 0) return 0;
    return value;
  }

  function getDisposableMonthly(result) {
    if (!result) return 0;
    const subscriptionsCost = getSubscriptionsTotal();
    const annualMonthlyEquivalent = getAnnualCostsMonthlyTotal();
    return result.netMonthly - subscriptionsCost - annualMonthlyEquivalent;
  }

  function renderProjection(result) {
    const disposable = getDisposableMonthly(result);
    const balance = getCurrentBalance();

    if (!result || result.grossMonthly <= 0) {
      projectionResult.innerHTML = `<span class="result-empty">Enter your income details above</span>`;
      updateChart([]);
      return;
    }

    const projected = balance + disposable * selectedProjectionMonths;
    projectionResult.innerHTML = `
      <span class="result-label">Projected balance (${selectedProjectionMonths} months)</span>
      <span class="result-value">\u00A3${formatCurrency(projected)}</span>
    `;

    updateChart(buildProjectionSeries(balance, disposable, selectedProjectionMonths));
  }

  function buildProjectionSeries(startBalance, monthlyDelta, months) {
    const series = [];
    for (let i = 0; i <= months; i += 1) {
      series.push({
        month: i,
        balance: startBalance + monthlyDelta * i,
      });
    }
    return series;
  }

  function updateChart(data) {
    if (!projectionChartCanvas) return;

    const labels = data.map((item) => item.month);
    const values = data.map((item) => item.balance);

    if (chartInstance) {
      chartInstance.data.labels = labels;
      chartInstance.data.datasets[0].data = values;
      chartInstance.update();
      return;
    }

    chartInstance = new Chart(projectionChartCanvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Projected Balance",
            data: values,
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.15)",
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `\u00A3${formatCurrency(context.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: "Months", color: "#9ca3af" },
            ticks: { color: "#9ca3af" },
            grid: { color: "rgba(30, 41, 59, 0.6)" },
          },
          y: {
            title: { display: true, text: "Balance (GBP)", color: "#9ca3af" },
            ticks: {
              color: "#9ca3af",
              callback: (value) => `\u00A3${formatCurrency(value)}`,
            },
            grid: { color: "rgba(30, 41, 59, 0.6)" },
          },
        },
      },
    });
  }

  function handleProjectionClick(event) {
    const target = event.target;
    if (!target.classList.contains("pill")) return;

    projectionOptions.querySelectorAll(".pill").forEach((pill) => {
      pill.classList.remove("active");
    });
    target.classList.add("active");

    selectedProjectionMonths = parseInt(target.dataset.months, 10);
    calculateMonthlyIncome();
  }

  function exportToPdf() {
    const exportContainer = document.getElementById("pdfExportContainer");
    const result = calculateLocally();
    const subscriptionsCost = getSubscriptionsTotal();
    const annualMonthlyEquivalent = getAnnualCostsMonthlyTotal();
    const annualTotal = getAnnualCostsAnnualTotal();
    const totalExpenses = subscriptionsCost + annualMonthlyEquivalent;
    const disposable = getDisposableMonthly(result);
    const currentBalance = getCurrentBalance();
    const projectedBalance = currentBalance + disposable * selectedProjectionMonths;
    const taxLabel = taxToggle.checked ? "Estimated monthly tax" : "Estimated monthly tax (off)";
    const generatedOn = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    exportContainer.innerHTML = `
      <div class="pdf-page">
        <header class="pdf-header">
          <h1>Monthly Budget Summary</h1>
          <span class="pdf-date">Generated ${generatedOn}</span>
        </header>

        <section class="pdf-card">
          <h2>Monthly Snapshot</h2>
          <div class="pdf-row">
            <span>Net income</span>
            <strong>\u00A3${formatCurrency(result ? result.netMonthly : 0)}</strong>
          </div>
          <div class="pdf-row">
            <span>Total expenses</span>
            <strong>\u00A3${formatCurrency(totalExpenses)}</strong>
          </div>
          <div class="pdf-row highlight">
            <span>Disposable income</span>
            <strong>\u00A3${formatCurrency(disposable)}</strong>
          </div>
        </section>

        <section class="pdf-section">
          <h2>Income</h2>
          <div class="pdf-row">
            <span>Gross monthly income</span>
            <strong>\u00A3${formatCurrency(result ? result.grossMonthly : 0)}</strong>
          </div>
          <div class="pdf-row">
            <span>${taxLabel}</span>
            <strong>\u00A3${formatCurrency(result ? result.monthlyTax : 0)}</strong>
          </div>
          <div class="pdf-row">
            <span>Net monthly income</span>
            <strong>\u00A3${formatCurrency(result ? result.netMonthly : 0)}</strong>
          </div>
        </section>

        <section class="pdf-section">
          <h2>Expenses</h2>
          <div class="pdf-row">
            <span>Monthly subscriptions</span>
            <strong>\u00A3${formatCurrency(subscriptionsCost)}</strong>
          </div>
          <div class="pdf-row">
            <span>Annual costs (monthly equivalent)</span>
            <strong>\u00A3${formatCurrency(annualMonthlyEquivalent)}</strong>
          </div>
          <div class="pdf-row">
            <span>Annual costs (total)</span>
            <strong>\u00A3${formatCurrency(annualTotal)}</strong>
          </div>
          <div class="pdf-row">
            <span>Total expenses</span>
            <strong>\u00A3${formatCurrency(totalExpenses)}</strong>
          </div>
        </section>

        <section class="pdf-section">
          <h2>Projection</h2>
          <div class="pdf-row">
            <span>Current balance</span>
            <strong>\u00A3${formatCurrency(currentBalance)}</strong>
          </div>
          <div class="pdf-row">
            <span>Timeframe</span>
            <strong>${selectedProjectionMonths} months</strong>
          </div>
          <div class="pdf-row">
            <span>Disposable income (per month)</span>
            <strong>\u00A3${formatCurrency(disposable)}</strong>
          </div>
          <div class="pdf-row highlight">
            <span>Projected balance</span>
            <strong>\u00A3${formatCurrency(projectedBalance)}</strong>
          </div>
        </section>

        <footer class="pdf-footer">
          <span>Monthly Budget Calculator</span>
          <span>${generatedOn}</span>
        </footer>
      </div>
    `;

    exportContainer.classList.add("is-exporting");

    const options = {
      margin: 10,
      filename: "budget-summary.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };

    html2pdf().set(options).from(exportContainer).save().then(() => {
      exportContainer.classList.remove("is-exporting");
      exportContainer.innerHTML = "";
    });
  }

  // Event Listeners
  toggle.addEventListener("change", updateView);
  taxToggle.addEventListener("change", calculateMonthlyIncome);

  // Live calculation on input - use 'input' event for real-time updates
  hourlyRateInput.addEventListener("input", calculateMonthlyIncome);
  hoursPerWeekInput.addEventListener("input", calculateMonthlyIncome);
  annualSalaryInput.addEventListener("input", calculateMonthlyIncome);
  currentBalanceInput.addEventListener("input", calculateMonthlyIncome);

  addSubBtn.addEventListener("click", addSubscription);
  subNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addSubscription();
  });
  subAmountInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addSubscription();
  });
  subscriptionsList.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("remove-btn")) {
      removeSubscription(target.dataset.id);
    }
  });

  addAnnualCostBtn.addEventListener("click", addAnnualCost);
  annualCostNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addAnnualCost();
  });
  annualCostAmountInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addAnnualCost();
  });
  annualCostsList.addEventListener("click", (event) => {
    const target = event.target;
    if (target.classList.contains("remove-btn")) {
      removeAnnualCost(target.dataset.id);
    }
  });

  projectionOptions.addEventListener("click", handleProjectionClick);
  exportPdfBtn.addEventListener("click", exportToPdf);

  // Initialize view
  updateView();
  renderSubscriptions();
  renderAnnualCosts();
});

"""
FastAPI backend for the Budgeting App.
Provides income calculation endpoints with CORS support for Vercel frontend.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from typing import Literal, Optional

app = FastAPI(
    title="Budgeting App API",
    description="API for calculating monthly income from hourly or annual rates",
    version="1.0.0",
)

# CORS configuration - allow requests from Vercel frontend
# Update these origins when you deploy
origins = [
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8080",
    # Add your Vercel deployment URL here, e.g.:
    # "https://your-app.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class IncomeRequest(BaseModel):
    """Request model for income calculation."""

    income_type: Literal["hourly", "annual"] = Field(
        ..., description="Type of income: 'hourly' or 'annual'"
    )
    hourly_rate: Optional[float] = Field(
        None, ge=0, description="Hourly wage (required if income_type is 'hourly')"
    )
    hours_per_week: Optional[float] = Field(
        None,
        ge=0,
        le=168,
        description="Contracted hours per week (required if income_type is 'hourly')",
    )
    annual_salary: Optional[float] = Field(
        None, ge=0, description="Annual salary (required if income_type is 'annual')"
    )
    tax_enabled: bool = Field(
        True, description="Whether to estimate income tax and National Insurance"
    )

    @model_validator(mode="after")
    def validate_income_fields(self):
        """Ensure required fields are present based on income_type."""
        if self.income_type == "hourly":
            if self.hourly_rate is None:
                raise ValueError("hourly_rate is required when income_type is 'hourly'")
            if self.hours_per_week is None:
                raise ValueError(
                    "hours_per_week is required when income_type is 'hourly'"
                )
        elif self.income_type == "annual":
            if self.annual_salary is None:
                raise ValueError(
                    "annual_salary is required when income_type is 'annual'"
                )
        return self


class IncomeResponse(BaseModel):
    """Response model for income calculation."""

    gross_annual_income: float = Field(
        ..., description="Calculated gross annual income"
    )
    gross_monthly_income: float = Field(
        ..., description="Calculated gross monthly income"
    )
    estimated_monthly_tax: float = Field(
        ..., description="Estimated monthly Income Tax + National Insurance"
    )
    net_monthly_income: float = Field(..., description="Estimated net monthly income")
    tax_enabled: bool = Field(..., description="Whether tax estimation was enabled")
    income_type: str = Field(..., description="The income type used for calculation")
    calculation_details: dict = Field(
        ..., description="Details about the calculation performed"
    )


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "message": "Budgeting App API is running"}


@app.post("/calculate-income", response_model=IncomeResponse)
async def calculate_income(request: IncomeRequest):
    """
    Calculate income breakdown from hourly wage or annual salary.

    **Hourly calculation:**
    - Monthly = (hourly_rate * hours_per_week * 52) / 12

    **Annual calculation:**
    - Monthly = annual_salary / 12
    """
    tax_year = "2025-2026"
    personal_allowance = 12570
    allowance_taper_start = 100000
    allowance_zero_at = 125140
    basic_rate_limit = 37700
    higher_rate_limit = 125140

    ni_primary_threshold = 12570
    ni_upper_earnings_limit = 50270
    ni_main_rate = 0.08
    ni_upper_rate = 0.02

    if request.income_type == "hourly":
        weekly_income = request.hourly_rate * request.hours_per_week
        annual_income = weekly_income * 52
        calc_details = {
            "hourly_rate": request.hourly_rate,
            "hours_per_week": request.hours_per_week,
            "weekly_income": round(weekly_income, 2),
            "annual_equivalent": round(annual_income, 2),
            "formula": "(hourly_rate * hours_per_week * 52) / 12",
        }
    else:
        annual_income = request.annual_salary
        calc_details = {
            "annual_salary": request.annual_salary,
            "formula": "annual_salary / 12",
        }

    monthly_income = annual_income / 12

    def calculate_personal_allowance(income: float) -> float:
        if income <= allowance_taper_start:
            return personal_allowance
        reduction = (income - allowance_taper_start) / 2
        return max(0, personal_allowance - reduction)

    def calculate_income_tax(income: float) -> float:
        allowance = calculate_personal_allowance(income)
        taxable_income = max(0, income - allowance)

        basic_taxable = min(taxable_income, basic_rate_limit)
        higher_taxable = min(
            max(taxable_income - basic_rate_limit, 0), higher_rate_limit - basic_rate_limit
        )
        additional_taxable = max(taxable_income - higher_rate_limit, 0)

        return (
            basic_taxable * 0.20
            + higher_taxable * 0.40
            + additional_taxable * 0.45
        )

    def calculate_employee_ni(income: float) -> float:
        if income <= ni_primary_threshold:
            return 0.0
        main_band = min(income, ni_upper_earnings_limit) - ni_primary_threshold
        upper_band = max(income - ni_upper_earnings_limit, 0)
        return (main_band * ni_main_rate) + (upper_band * ni_upper_rate)

    annual_income_tax = calculate_income_tax(annual_income) if request.tax_enabled else 0.0
    annual_ni = calculate_employee_ni(annual_income) if request.tax_enabled else 0.0
    annual_tax_total = annual_income_tax + annual_ni
    monthly_tax = annual_tax_total / 12
    net_monthly_income = monthly_income - monthly_tax

    calc_details.update(
        {
            "tax_year": tax_year,
            "personal_allowance": personal_allowance,
            "personal_allowance_taper_start": allowance_taper_start,
            "personal_allowance_zero_at": allowance_zero_at,
            "basic_rate_limit": basic_rate_limit,
            "higher_rate_limit": higher_rate_limit,
            "income_tax_annual": round(annual_income_tax, 2),
            "national_insurance_annual": round(annual_ni, 2),
            "tax_enabled": request.tax_enabled,
        }
    )

    return IncomeResponse(
        gross_annual_income=round(annual_income, 2),
        gross_monthly_income=round(monthly_income, 2),
        estimated_monthly_tax=round(monthly_tax, 2),
        net_monthly_income=round(net_monthly_income, 2),
        tax_enabled=request.tax_enabled,
        income_type=request.income_type,
        calculation_details=calc_details,
    )


# For running locally with: python main.py
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

"""Borrower names and personas for AI Borrower mode.

Each borrower is given a random name and an archetype. The archetype carries two behavioural
modifiers that feed straight into the model, so the persona genuinely *influences the
borrower's parameters* rather than being cosmetic:

* ``risk_mult``  -- scales the monthly miss probability (a reliable salaried worker misses
                    less often than an overleveraged spender).
* ``shock_mult`` -- scales how hard an economic shock hits this borrower (a small-business
                    owner is far more exposed to a recession than a dual-income household).

When the LLM decision layer is available, the same persona blurb is also handed to the model
so its pay/miss reasoning reflects the borrower's situation.
"""

FIRST_NAMES = [
    "Ava", "Liam", "Sofia", "Noah", "Mia", "Ethan", "Zoe", "Lucas", "Nora", "Kai",
    "Priya", "Omar", "Lena", "Diego", "Yuki", "Amara", "Finn", "Isla", "Mateo", "Hana",
    "Ravi", "Elsa", "Tariq", "Freya", "Jonas", "Aisha", "Marco", "Nadia", "Theo", "Ingrid",
]

LAST_NAMES = [
    "Reyes", "Novak", "Okafor", "Bianchi", "Haas", "Costa", "Larsen", "Mensah", "Petrov", "Khan",
    "Moreau", "Silva", "Tanaka", "Weber", "Nguyen", "Rossi", "Andersen", "Duval", "Kaya", "Sharma",
    "Vogel", "Fischer", "Romano", "Berg", "Adeyemi", "Marín", "Holm", "Faridi", "Klein", "Sato",
]

ARCHETYPES = [
    {"title": "Salaried professional", "blurb": "steady monthly paycheck, pays bills on autopilot",
     "risk_mult": 0.55, "shock_mult": 0.9},
    {"title": "Gig-economy driver", "blurb": "income swings week to week",
     "risk_mult": 1.35, "shock_mult": 1.6},
    {"title": "Recent graduate", "blurb": "thin credit file on an entry-level salary",
     "risk_mult": 1.15, "shock_mult": 1.3},
    {"title": "Overleveraged spender", "blurb": "juggling several cards and loans at once",
     "risk_mult": 1.7, "shock_mult": 1.5},
    {"title": "Small-business owner", "blurb": "cash flow rises and falls with the economy",
     "risk_mult": 1.1, "shock_mult": 2.2},
    {"title": "Retiree on a pension", "blurb": "fixed income, careful budgeter",
     "risk_mult": 0.7, "shock_mult": 1.4},
    {"title": "Dual-income household", "blurb": "two earners cushion the monthly bills",
     "risk_mult": 0.5, "shock_mult": 0.7},
    {"title": "Freelance creative", "blurb": "lumpy, project-based income",
     "risk_mult": 1.4, "shock_mult": 1.5},
    {"title": "Healthcare worker", "blurb": "stable demand and reliable shifts",
     "risk_mult": 0.65, "shock_mult": 0.8},
    {"title": "Seasonal worker", "blurb": "earns big in season, lean the rest of the year",
     "risk_mult": 1.3, "shock_mult": 1.8},
]


def assign(borrowers, rng):
    """Give each borrower a unique-ish name and a random archetype (seeded by ``rng``)."""
    for b in borrowers:
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        b.name = name
        b.persona = rng.choice(ARCHETYPES)

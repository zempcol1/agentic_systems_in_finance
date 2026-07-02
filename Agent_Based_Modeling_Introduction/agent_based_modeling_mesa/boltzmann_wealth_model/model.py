"""Boltzmann wealth model — extended "money game" engine.

Built on Mesa's classic Boltzmann wealth example but generalised for an
interactive teaching sandbox. Compared with the stock model
(``mesa.examples.basic.boltzmann_wealth_model``) this adds:

* **Per-transfer logging** (``model.transactions``) so the frontend can animate
  each exchange and play a sound.
* **Two spaces**: the classic Moore **grid** (exchange with a cell-mate) and a
  **continuous space** (exchange with any neighbour within an interaction
  radius — coins then genuinely fly across space).
* **Exchange-rule variants**: ``random`` (classic), ``give_to_poorer``,
  ``give_fraction`` and ``saving_propensity`` (Chakraborti–Chakrabarti).
* **Tax / redistribution**: each step, optionally skim a fraction of everyone's
  wealth into a pot and redistribute it evenly.

Wealth is kept as an **integer** in every mode (the saving model uses an integer
approximation) so the per-unit histogram and the Boltzmann–Gibbs theory overlay
stay clean. The economics of the default settings are unchanged from
Dragulescu & Yakovenko: equal start, random local transfers, inequality emerges.
"""

import math

from mesa import Model
from mesa.datacollection import DataCollector
from mesa.discrete_space import CellAgent, OrthogonalMooreGrid
from mesa.experimental.continuous_space import ContinuousSpace, ContinuousSpaceAgent
from mesa.experimental.scenarios import Scenario


class GameScenario(Scenario):
    """All tunable parameters for the money-game model (with defaults)."""

    n: int = 100
    width: int = 10
    height: int = 10
    initial_wealth: int = 1  # units each agent starts with (raise for finer distributions)
    space_mode: str = "grid"  # "grid" | "continuous"
    interaction_radius: float = 1.5  # continuous mode: who counts as a neighbour
    step_size: float = 1.0  # continuous mode: random-walk distance per step
    exchange_rule: str = "random"  # random | give_to_poorer | give_fraction | saving_propensity
    give_fraction: float = 0.5  # give_fraction rule: share of wealth transferred
    saving_lambda: float = 0.5  # saving_propensity rule: fraction each agent keeps
    tax_rate: float = 0.0  # per-step redistribution (0 = off)


# Kept as an alias so external imports referencing the classic name still work.
BoltzmannScenario = GameScenario


def _reflect(v, hi):
    """Keep a coordinate inside [0, hi] by reflecting off the walls (no wrap-around)."""
    if v < 0:
        v = -v
    elif v > hi:
        v = 2 * hi - v
    return min(max(v, 0.0), hi)


def _perform_exchange(giver, candidates):
    """Apply the model's exchange rule between ``giver`` and one of ``candidates``.

    Mutates wealth in place and appends a ``{fromX, fromY, toX, toY}`` record to
    ``giver.model.transactions``. ``candidates`` is the list of eligible partners
    (cell-mates in grid mode, radius-neighbours in continuous mode).
    """
    model = giver.model
    rng = model.random
    rule = model.scenario.exchange_rule

    if rule == "give_to_poorer":
        min_w = min(c.wealth for c in candidates)
        other = rng.choice([c for c in candidates if c.wealth == min_w])
    else:
        other = rng.choice(candidates)

    if rule == "saving_propensity":
        # Chakraborti–Chakrabarti: both keep a fraction lambda, the rest is
        # pooled and split randomly. Integer approximation to keep wealth whole.
        lam = model.scenario.saving_lambda
        pot = giver.wealth + other.wealth
        keep_g = int(lam * giver.wealth)
        keep_o = int(lam * other.wealth)
        traded = pot - keep_g - keep_o
        share = rng.randint(0, traded) if traded > 0 else 0
        giver.wealth = keep_g + share
        other.wealth = keep_o + (traded - share)
    else:
        if rule == "give_fraction":
            amount = max(1, int(giver.wealth * model.scenario.give_fraction))
        else:  # random / give_to_poorer transfer one unit
            amount = 1
        amount = min(amount, giver.wealth)
        giver.wealth -= amount
        other.wealth += amount

    fx, fy = giver.locate()
    tx, ty = other.locate()
    model.transactions.append({"fromX": fx, "fromY": fy, "toX": tx, "toY": ty})


class GridMoneyAgent(CellAgent):
    """Money agent on a Moore grid: move to a neighbouring cell, trade with a cell-mate."""

    def __init__(self, model, cell):
        super().__init__(model)
        self.cell = cell
        self.wealth = model.scenario.initial_wealth

    def locate(self):
        return self.cell.coordinate

    def move(self):
        self.cell = self.cell.neighborhood.select_random_cell()

    def step(self):
        self.move()
        if self.wealth > 0:
            candidates = [a for a in self.cell.agents if a is not self]
            if candidates:
                _perform_exchange(self, candidates)


class ContinuousMoneyAgent(ContinuousSpaceAgent):
    """Money agent in continuous space: random-walk, trade within a radius."""

    def __init__(self, space, model):
        super().__init__(space, model)
        self.wealth = model.scenario.initial_wealth

    def locate(self):
        return float(self.position[0]), float(self.position[1])

    def move(self):
        heading = self.random.uniform(0, 2 * math.pi)
        step = self.model.scenario.step_size
        x = _reflect(self.position[0] + math.cos(heading) * step, self.model.width)
        y = _reflect(self.position[1] + math.sin(heading) * step, self.model.height)
        self.position = [x, y]

    def step(self):
        self.move()
        if self.wealth > 0:
            neighbors, _ = self.get_neighbors_in_radius(self.model.scenario.interaction_radius)
            if len(neighbors):
                _perform_exchange(self, list(neighbors))


class BoltzmannGame(Model):
    """The money-game model: grid or continuous space, pluggable exchange rule, tax."""

    def __init__(self, scenario=None):
        if scenario is None:
            scenario = GameScenario()
        super().__init__(scenario=scenario)  # exposes it as self.scenario

        self.num_agents = scenario.n
        self.width = scenario.width
        self.height = scenario.height
        self.space_mode = scenario.space_mode
        self.transactions = []

        self.datacollector = DataCollector(
            model_reporters={"Gini": "gini"},
            agent_reporters={"Wealth": "wealth"},
        )

        if scenario.space_mode == "continuous":
            # Bounded (torus=False): agents reflect off the walls in move(), so
            # they never wrap from one edge to the opposite one.
            self.space = ContinuousSpace(
                [[0, self.width], [0, self.height]], torus=False, random=self.random
            )
            for _ in range(self.num_agents):
                agent = ContinuousMoneyAgent(self.space, self)
                agent.position = [
                    self.random.uniform(0, self.width),
                    self.random.uniform(0, self.height),
                ]
        else:
            # torus=False -> bounded grid: edge cells have no wrap-around neighbours.
            self.grid = OrthogonalMooreGrid(
                (self.width, self.height), torus=False, random=self.random
            )
            GridMoneyAgent.create_agents(
                self,
                self.num_agents,
                self.random.choices(self.grid.all_cells.cells, k=self.num_agents),
            )

        self.running = True
        self.datacollector.collect(self)

    def step(self):
        self.transactions = []
        self.agents.shuffle_do("step")
        if self.scenario.tax_rate > 0:
            self._apply_tax()
        self.datacollector.collect(self)

    def _apply_tax(self):
        """Skim ``tax_rate`` of each agent's wealth into a pot, redistribute evenly."""
        agents = list(self.agents)
        rate = self.scenario.tax_rate
        pot = 0
        for a in agents:
            levy = int(round(rate * a.wealth))
            levy = min(levy, a.wealth)
            a.wealth -= levy
            pot += levy
        if pot == 0:
            return
        n = len(agents)
        share = pot // n
        if share:
            for a in agents:
                a.wealth += share
        remainder = pot - share * n
        for a in self.random.sample(agents, remainder):
            a.wealth += 1

    @property
    def gini(self):
        """Gini coefficient of the current wealth distribution (0 = equal, →1 = unequal)."""
        wealths = [agent.wealth for agent in self.agents]
        x = sorted(wealths)
        n = self.num_agents
        total = sum(x)
        if total == 0:
            return 0.0
        b = sum(xi * (n - i) for i, xi in enumerate(x)) / (n * total)
        return 1 + (1 / n) - 2 * b


def lorenz_points(wealths):
    """Return Lorenz-curve points as ``[{"p": pop_share, "w": wealth_share}, ...]``.

    ``p`` is the cumulative share of the population (poorest first) and ``w`` the
    cumulative share of total wealth. Prefixed with the origin ``(0, 0)`` so the
    curve can be drawn directly. With all-equal wealth the curve is the 45 deg
    diagonal; the more it sags below the diagonal, the more unequal the economy.
    """
    n = len(wealths)
    points = [{"p": 0.0, "w": 0.0}]
    if n == 0:
        return points

    total = sum(wealths)
    ordered = sorted(wealths)
    cumulative = 0
    for i, value in enumerate(ordered, start=1):
        cumulative += value
        points.append(
            {
                "p": i / n,
                "w": (cumulative / total) if total > 0 else i / n,
            }
        )
    return points


def wealth_histogram(wealths):
    """Return ``[{"wealth": k, "count": c}, ...]`` counts per integer wealth level."""
    counts = {}
    for w in wealths:
        k = int(round(w))
        counts[k] = counts.get(k, 0) + 1
    lo, hi = min(counts), max(counts)
    return [{"wealth": k, "count": int(counts.get(k, 0))} for k in range(lo, hi + 1)]

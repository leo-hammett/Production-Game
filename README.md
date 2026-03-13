# Production Game – Pre-Game Strategy & Software

This repository contains the decision-support software developed for the Cambridge Production Game. The system supports production planning, order evaluation, inventory management, and workstation coordination to maximise profit under time and resource constraints.

The software evaluates incoming orders based on expected profit per second, accounting for processing time, material lead times, and the probability of late completion. It automatically generates optimal production schedules using an expected-profit model and updates decisions dynamically as worker performance and processing times change.

## Key features include:
Order evaluation and scheduling engine based on expected profit and completion risk

Inventory management dashboard with real-time stock tracking and procurement planning

Production monitoring interface for tracking station performance and order progress

Worker workstation dashboards showing job queues, expected completion times, and visual card templates

Transaction ledger for logging procurement and inter-team trades


Processing times are modelled using time-study data and normal distributions, allowing the system to estimate the probability of late orders and adjust schedules accordingly.

The tool was designed to support lean production principles, minimise bottlenecks, and ensure that limited production capacity is allocated to the most profitable orders.

// Get all orders, and create a distribution for predicting the times of future orders (should this be poisson or normal distribution?)
// Get all orders and create a distribution for predicting future profit per order (also make a global gamestate parameter called greedometer and we will make a ui to set it with bullish and bearish, this will be used to adjust the model)
// Get all orders and create a distribution for predicting future time per order  - also build into a gamestate parameter called forecastSpeed and use this rather than current station speeds for predicting future completion times

// All three of the above models should be calculated on the past orders using their data, and should be stored in a forecasts class added to gamestate, this will be used for deciding future actions and hopefully if i'm clever for simulating the outcome profit of the game.
// these models should be objects of their distributions, in a forecast class, but the things above should be functions that update the distributions at points where we think we have new information, we will call forecast updating with something like gameState.forecasting.update

// --- do the above code first, then we will work on below.
//
// estimated outcome should be done by then generating the future orders, and deciding as the computer suggests, which ones to do and when, obviously this should automatically mean we don't do ones when occupied, and this should account for the lack of true knowledge. when the time reaches 0, the profit value from this simulation is our estimated profit. this means making a simulator function, that starts with current cash and inventory and then continues with a simulated cash and simulated inventory until the end, at which point it liquidifies in the same way the main system does (ideally we reuse that code for this so i can update one and both work)
// this estimated profit will help us compare the value of accepting a deal and waiting for a potentially better one - so we no longer just accept break even orders.

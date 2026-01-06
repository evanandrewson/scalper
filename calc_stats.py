import re

total_pnl = 0
wins = 0
losses = 0
trades = []

with open('trades.txt', 'r') as f:
    for line in f:
        match = re.search(r'P&L: \$([-0-9.]+)', line)
        if match:
            pnl = float(match.group(1))
            total_pnl += pnl
            if pnl > 0:
                wins += 1
            else:
                losses += 1
            trades.append(pnl)

total_trades = wins + losses
win_rate = (wins / total_trades * 100) if total_trades > 0 else 0

print(f'Total Trades: {total_trades}')
print(f'Wins: {wins}')
print(f'Losses: {losses}')
print(f'Win Rate: {win_rate:.2f}%')
print(f'Total PnL: ${total_pnl:.2f}')

describe('toExpiryLedger', () => {
  it('converts seconds to ledger offset correctly', async () => {
    jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
    const result = await service.toExpiryLedger(3600); // 1 hour
    // 3600 / 5 = 720 ledgers + 10 buffer + 1000 current = 1730
    expect(result).toBe(1730);
  });

  it('rounds up fractional ledger counts', async () => {
    jest.spyOn(service, 'getCurrentLedger').mockResolvedValue(1000);
    const result = await service.toExpiryLedger(7); // 7 / 5 = 1.4 → ceil = 2
    expect(result).toBe(1012); // 1000 + 2 + 10
  });
});

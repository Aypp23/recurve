"use client";

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  CreditCard,
  Calendar,
  CheckCircle,
  ArrowRight,
  Zap,
  Shield,
  Coins,
  ArrowLeft,
  Lock,
  Loader2,
  ChevronRight,
  Copy,
  Check
} from 'lucide-react';
import { usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import {
  createPublicClient,
  http,
  defineChain,
  createWalletClient,
  custom
} from 'viem';
import { createSmartAccountClient } from 'permissionless';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint07Address } from 'viem/account-abstraction';
import SubscriptionManagerABI from '../contracts/SubscriptionManager.json';

const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://arc-testnet.g.alchemy.com/v2/jpcQ1LqU0BqGhQvz7oeoW9rrcovJx3x_'] }
  }
});

const CONTRACT_ADDRESS = "0x3C892b6eCeE6fb5C8f5519A0E5DB14C5A4a2C27a";

type ViewState = 'selection' | 'checkout' | 'success' | 'portal';

export default function CheckoutPage() {
  const { login, logout, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();

  const [view, setView] = useState<ViewState>('selection');
  const [selectedTier, setSelectedTier] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [eoaUsdcBalance, setEoaUsdcBalance] = useState<string>('0.00');
  const [smartUsdcBalance, setSmartUsdcBalance] = useState<string>('0.00');
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [cancellingSubId, setCancellingSubId] = useState<string | null>(null);

  const copyToClipboard = (addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddress(addr);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const formatAddress = (addr: string) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const setTemporaryStatus = (msg: string, duration = 5000) => {
    setStatus(msg);
    setTimeout(() => {
      // Only clear if the current status is still the one we set or an error
      setStatus(prev => prev === msg ? '' : prev);
    }, duration);
  };

  // Debugging
  useEffect(() => {
    if (authenticated && user) {
      console.log("DEBUG: Privy User Object:", user);
      console.log("DEBUG: Linked Accounts:", user.linkedAccounts);
      console.log("DEBUG: Smart Wallet metadata:", user.smartWallet);
      console.log("DEBUG: Wallets Registry:", wallets.map(w => ({ type: w.walletClientType, address: w.address })));
      console.log("DEBUG: Smart Wallet Client account:", smartWalletClient?.account?.address);
    }
  }, [authenticated, user, wallets, smartWalletClient]);

  // Detect wallet changes from provider and trigger logout
  const initialExternalWalletRef = React.useRef<string | null>(null);
  const [isSessionStable, setIsSessionStable] = useState(false);

  // Mark session as stable after a short delay (prevents logout during initial login)
  useEffect(() => {
    if (authenticated) {
      const timer = setTimeout(() => setIsSessionStable(true), 3000);
      return () => clearTimeout(timer);
    } else {
      setIsSessionStable(false);
      initialExternalWalletRef.current = null;
    }
  }, [authenticated]);

  useEffect(() => {
    if (!isSessionStable) return; // Don't check until session is stable

    // Find external wallet (MetaMask, Zerion, etc.)
    const externalWallet = wallets.find(w =>
      w.walletClientType !== 'privy' &&
      w.walletClientType !== 'smart_wallet' &&
      w.connectorType === 'injected'
    )?.address;

    if (externalWallet) {
      if (!initialExternalWalletRef.current) {
        // First time - record the initial wallet
        initialExternalWalletRef.current = externalWallet;
        console.log("DEBUG: Initial external wallet set:", externalWallet);
      } else if (externalWallet !== initialExternalWalletRef.current) {
        // Wallet changed! Auto-logout
        console.log("DEBUG: Wallet changed from", initialExternalWalletRef.current, "to", externalWallet);
        console.log("DEBUG: Auto-logging out due to wallet change...");
        logout();
      }
    }
  }, [isSessionStable, wallets, logout]);

  // Clear Identification of Wallets - Prefer external wallets over embedded
  const eoaWallet = wallets.find(w => w.walletClientType === 'metamask' || w.walletClientType === 'coinbase_wallet' || w.walletClientType === 'rainbow') ||
    wallets.find(w => w.connectorType === 'injected') ||
    wallets.find(w => w.walletClientType !== 'privy' && w.walletClientType !== 'smart_wallet') ||
    wallets.find(w => w.address === user?.wallet?.address) ||
    wallets[0];

  const smartWalletAddress = user?.smartWallet?.address ||
    user?.linkedAccounts?.find(a => a.type === 'smart_wallet')?.address ||
    wallets.find(w => w.walletClientType === 'smart_wallet')?.address ||
    smartWalletClient?.account?.address;

  const smartWallet = wallets.find(w => w.address === smartWalletAddress);
  const wallet = smartWallet || eoaWallet;
  const account = smartWalletAddress || wallet?.address;

  const activeSub = subscriptions.find(s => s.active);

  const tiers = [
    { id: 0, name: 'Basic', amount: '1', frequency: 'Monthly', desc: 'Essential features for individuals.' },
    { id: 1, name: 'Pro', amount: '2', frequency: 'Monthly', desc: 'Advanced tools for power users.' },
    { id: 2, name: 'Enterprise', amount: '3', frequency: 'Monthly', desc: 'Full-scale solution for teams.' },
  ];


  const fetchBalances = async () => {
    if (!authenticated) return;
    try {
      const provider = new ethers.JsonRpcProvider("https://arc-testnet.g.alchemy.com/v2/jpcQ1LqU0BqGhQvz7oeoW9rrcovJx3x_");
      const usdcAbi = ["function balanceOf(address account) view returns (uint256)"];
      const usdcContract = new ethers.Contract("0x3600000000000000000000000000000000000000", usdcAbi, provider);

      if (eoaWallet) {
        const eoaBal = await usdcContract.balanceOf(eoaWallet.address);
        setEoaUsdcBalance(ethers.formatUnits(eoaBal, 6));
      }

      if (smartWalletAddress) {
        const smartBal = await usdcContract.balanceOf(smartWalletAddress);
        setSmartUsdcBalance(ethers.formatUnits(smartBal, 6));
      }
      console.log("DEBUG: Balances refreshed successfully.");
    } catch (err) {
      console.error("Failed to fetch balances", err);
    }
  };

  const fetchSubscriptions = async (retryCount = 0) => {
    // CRITICAL: We MUST query by the Smart Wallet address (account), not just the EOA (wallet.address)
    const subscriber = account;
    if (!subscriber) return;

    console.log("DEBUG: Fetching subscriptions for subscriber:", subscriber);
    try {
      const provider = new ethers.JsonRpcProvider("https://arc-testnet.g.alchemy.com/v2/jpcQ1LqU0BqGhQvz7oeoW9rrcovJx3x_");
      const contract = new ethers.Contract(CONTRACT_ADDRESS, SubscriptionManagerABI.abi, provider);

      // 1. Fetch exact IDs from contract mapping
      let ids: string[] = [];
      let i = 0;
      while (true) {
        try {
          // Solidity auto-getter for userSubscriptions(address, uint256) returns bytes32
          const id = await contract.userSubscriptions(subscriber, i);
          ids.push(id);
          i++;
        } catch (e) {
          break; // Reached end of array
        }
      }

      // 2. Fetch data (this returns Subscription structs in same order as IDs)
      const rawSubs = await contract.getSubscriptionsBySubscriber(subscriber);

      // 3. Merge data with IDs (Explicit mapping for ethers v6 Result objects)
      const combined = rawSubs.map((sub: any, idx: number) => ({
        subscriber: sub.subscriber,
        tierId: sub.tierId,
        lastPaid: sub.lastPaid,
        active: sub.active,
        subId: ids[idx]
      }));

      console.log(`DEBUG: Subscriptions found (count: ${combined.length}, retry: ${retryCount})`);

      if (combined.length === 0 && retryCount < 5) {
        console.log("DEBUG: No subscriptions found, retrying in 3s...");
        setTimeout(() => fetchSubscriptions(retryCount + 1), 3000);
        return;
      }

      setSubscriptions(combined);
    } catch (err) {
      console.error("Failed to fetch subscriptions", err);
    }
  };

  useEffect(() => {
    setMounted(true);
    if (authenticated) {
      fetchBalances();
      fetchSubscriptions();
    } else {
      setEoaUsdcBalance('0.00');
      setSmartUsdcBalance('0.00');
      setSubscriptions([]);
    }
  }, [authenticated, wallets.length, smartWalletAddress]);

  // Auto-refresh subscriptions every 15 seconds when viewing the portal
  useEffect(() => {
    if (view !== 'portal' || !authenticated) return;

    const interval = setInterval(() => {
      console.log("AUTO-REFRESH: Updating subscriptions...");
      fetchSubscriptions();
      fetchBalances();
    }, 15000);

    return () => clearInterval(interval);
  }, [view, authenticated, account]);

  const handleDeposit = async () => {
    if (!eoaWallet || !smartWalletAddress || !depositAmount) {
      console.log("Deposit blocked:", { eoaWallet: !!eoaWallet, smartWalletAddress: !!smartWalletAddress, depositAmount });
      return;
    }
    setLoading(true);
    setStatus('Transferring USDC to Subscription Vault...');
    try {
      await eoaWallet.switchChain(5042002);
      const ethProvider = await eoaWallet.getEthereumProvider();
      const provider = new ethers.BrowserProvider(ethProvider);
      const signer = await provider.getSigner();

      const usdcAddress = "0x3600000000000000000000000000000000000000";
      const usdcAbi = ["function transfer(address to, uint256 amount) returns (bool)"];
      const usdcContract = new ethers.Contract(usdcAddress, usdcAbi, signer);

      const tx = await usdcContract.transfer(smartWalletAddress, ethers.parseUnits(depositAmount, 6));
      await tx.wait();

      await fetchBalances();
      setDepositAmount('');
      setStatus('Vault funded successfully!');
      setTimeout(() => setStatus(''), 3000);
    } catch (err: any) {
      console.error(err);
      const isRejected = err.message?.includes('User rejected') || err.message?.includes('user rejected');
      setTemporaryStatus(isRejected ? 'User rejected the request' : `Deposit failed: ${err.message?.slice(0, 40) || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    // Robust detection: Look in registry AND hook state
    const activeSmartWallet = smartWallet || wallets.find(w => w.walletClientType === 'smart_wallet');

    console.log("DEBUG: handleSubscribe starting...");
    console.log("DEBUG: smartWalletAddress (metadata):", smartWalletAddress);
    console.log("DEBUG: smartWallet object (registry):", smartWallet?.address);
    console.log("DEBUG: activeSmartWallet (registry search):", activeSmartWallet?.address);
    console.log("DEBUG: smartWalletClient exists:", !!smartWalletClient);

    if (!authenticated) {
      login();
      return;
    }

    // DEBUG: Inspect registry and account
    console.log("DEBUG: Wallets Registry Detail:", wallets.map(w => ({ address: w.address, type: w.walletClientType })));
    console.log("DEBUG: Smart Wallet Client account object:", smartWalletClient?.account);

    // CRITICAL: We can proceed if EITHER registry wallet OR smartWalletClient exists
    const activeRegistrySmartWallet = wallets.find(w => w.walletClientType === 'smart_wallet' || (w as any).type === 'smart_wallet');

    if (!activeRegistrySmartWallet && !smartWalletClient) {
      console.log("DEBUG: Both smart wallet sources are null.");
      if (smartWalletAddress) {
        setStatus('Connecting to Vault... (Registry pending)');
      } else {
        setStatus('Please create a Subscription Vault first.');
      }
      return;
    }

    if (parseFloat(smartUsdcBalance) < parseFloat(selectedTier.amount)) {
      setStatus('Insufficient Vault balance. Please deposit USDC.');
      return;
    }

    setLoading(true);
    setStatus(activeSub ? 'Switching your plan...' : 'Preparing sponsored subscription...');

    try {
      const usdcAddress = "0x3600000000000000000000000000000000000000";
      const usdcInterface = new ethers.Interface([
        "function approve(address spender, uint256 amount) returns (bool)"
      ]);
      const subInterface = new ethers.Interface(SubscriptionManagerABI.abi);

      const approveData = usdcInterface.encodeFunctionData("approve", [CONTRACT_ADDRESS, ethers.MaxUint256]);

      // Use switchSubscription for upgrades/downgrades (prorated), createSubscription for new subs
      const subscribeData = activeSub
        ? subInterface.encodeFunctionData("switchSubscription", [activeSub.subId, selectedTier.id])
        : subInterface.encodeFunctionData("createSubscription", [selectedTier.id]);

      if (smartWallet) {
        console.log("DEBUG: Using smartWallet from registry as signer");
        await smartWallet.switchChain(5042002);
        const ethereumProvider = await smartWallet.getEthereumProvider();
        const provider = new ethers.BrowserProvider(ethereumProvider);
        const signer = await provider.getSigner();

        const usdcContract = new ethers.Contract(usdcAddress, usdcInterface, signer);
        const amount = ethers.parseUnits(selectedTier.amount, 6);

        // 1. Check Allowance
        setStatus('Authorizing Subscription Vault...');
        const currentAllowance = await usdcContract.allowance(smartWallet.address, CONTRACT_ADDRESS);

        if (currentAllowance < amount) {
          const approveTx = await usdcContract.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
          await approveTx.wait();
        }

        // 2. Create/Update Subscription with proration
        setStatus(activeSub ? 'Switching plan (prorated)...' : 'Activating subscription...');
        const contract = new ethers.Contract(CONTRACT_ADDRESS, subInterface, signer);

        // Use switchSubscription for prorated upgrades/downgrades
        if (activeSub) {
          const tx = await contract.switchSubscription(activeSub.subId, selectedTier.id);
          await tx.wait();
        } else {
          const tx = await contract.createSubscription(selectedTier.id);
          await tx.wait();
        }
      } else if (smartWalletClient) {
        console.log("DEBUG: Executing manual authenticated transaction via permissionless.js");
        setStatus(activeSub ? 'Batching plan update...' : 'Initializing authenticated bundler...');

        // 1. Get the account from Privy's client
        const privyAccount = (smartWalletClient as any).account;
        if (!privyAccount) throw new Error("Smart wallet account not found on client.");

        console.log("DEBUG: Using Privy account address:", privyAccount.address);
        console.log("DEBUG: Registry Smart Wallet Address:", smartWalletAddress);

        // 2. Setup Authenticated Pimlico Client
        const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY || "";
        const pimlicoUrl = `https://api.pimlico.io/v2/5042002/rpc?apikey=${pimlicoApiKey}`;

        const publicClient = createPublicClient({
          chain: arcTestnet,
          transport: http()
        });

        const pimlicoClient = createPimlicoClient({
          chain: arcTestnet,
          transport: http(pimlicoUrl),
          entryPoint: {
            address: entryPoint07Address,
            version: "0.7"
          }
        });

        // 3. Initialize Smart Account Client with Privy's account
        const customSmartAccountClient = createSmartAccountClient({
          account: privyAccount,
          chain: arcTestnet,
          bundlerTransport: http(pimlicoUrl),
          paymaster: pimlicoClient,
          userOperation: {
            estimateFeesPerGas: async () => {
              try {
                const prices = await pimlicoClient.getUserOperationGasPrice();
                console.log("DEBUG: UserOperation Gas Prices:", prices);
                return prices.fast;
              } catch (e) {
                console.error("DEBUG: Failed to fetch gas prices:", e);
                throw e;
              }
            }
          }
        });

        setStatus(activeSub ? 'Executing prorated plan switch...' : 'Executing sponsored transaction...');
        console.log("DEBUG: Sending transaction...", {
          calls: [
            { to: usdcAddress, data: approveData },
            { to: CONTRACT_ADDRESS, data: subscribeData }  // subscribeData already uses switchSubscription if activeSub
          ]
        });

        try {
          const txHash = await customSmartAccountClient.sendTransaction({
            calls: [
              { to: usdcAddress as `0x${string}`, data: approveData as `0x${string}` },
              { to: CONTRACT_ADDRESS as `0x${string}`, data: subscribeData as `0x${string}` }
            ]
          });

          console.log("DEBUG: Manual transaction sent. Hash:", txHash);
          setStatus('Transaction sent! Waiting for confirmation...');

          // Wait for confirmation
          await publicClient.waitForTransactionReceipt({ hash: txHash });
          console.log("DEBUG: Transaction confirmed.");
        } catch (txErr: any) {
          console.error("DEBUG: Transaction Execution Error Object:", txErr);
          // Extract more info if available
          if (txErr.details) console.error("DEBUG: Error Details:", txErr.details);
          if (txErr.shortMessage) console.error("DEBUG: Short Message:", txErr.shortMessage);
          throw txErr;
        }
      } else {
        throw new Error("No smart wallet source available.");
      }

      setStatus('Refreshing data...');
      await fetchSubscriptions();
      await fetchBalances();
      setStatus('');
      setView('success');
    } catch (err: any) {
      console.error(err);
      const isRejected = err.message?.includes('User rejected') || err.message?.includes('user rejected');
      setTemporaryStatus(isRejected ? 'User rejected the request' : `Payment failed: ${err.message?.slice(0, 40) || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (subId: string) => {
    if (!smartWalletClient || !subId) return;

    setCancellingSubId(subId);
    try {
      const subInterface = new ethers.Interface(SubscriptionManagerABI.abi);
      const cancelData = subInterface.encodeFunctionData("cancelSubscription", [subId]);

      // Using same manual permissionless client logic as handleSubscribe
      const accountObj = (smartWalletClient as any).account;
      if (!accountObj) throw new Error("No account found on client.");

      const pimlicoApiKey = process.env.NEXT_PUBLIC_PIMLICO_API_KEY || "";
      const pimlicoUrl = `https://api.pimlico.io/v2/5042002/rpc?apikey=${pimlicoApiKey}`;

      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const pimlicoClient = createPimlicoClient({
        chain: arcTestnet,
        transport: http(pimlicoUrl),
        entryPoint: {
          address: entryPoint07Address,
          version: "0.7"
        }
      });

      const customSmartAccountClient = createSmartAccountClient({
        account: accountObj,
        chain: arcTestnet,
        bundlerTransport: http(pimlicoUrl),
        paymaster: pimlicoClient,
        userOperation: {
          estimateFeesPerGas: async () => {
            try {
              const prices = await pimlicoClient.getUserOperationGasPrice();
              console.log("DEBUG: Cancellation Gas Prices:", prices);
              return prices.fast;
            } catch (e) {
              console.error("DEBUG: Failed to fetch gas prices for cancellation:", e);
              throw e;
            }
          }
        }
      });

      console.log(`DEBUG: Sending cancellation for sub ${subId.slice(0, 10)}...`);
      const txHash = await customSmartAccountClient.sendTransaction({
        calls: [
          { to: CONTRACT_ADDRESS as `0x${string}`, data: cancelData as `0x${string}` }
        ]
      });

      console.log("DEBUG: Cancellation sent. Hash:", txHash);
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log("DEBUG: Cancellation confirmed.");
      await fetchSubscriptions();
    } catch (err: any) {
      console.error("Cancellation failed:", err);
      const isRejected = err.message?.includes('User rejected') || err.message?.includes('user rejected');
      setTemporaryStatus(isRejected ? 'User rejected the request' : `Cancellation failed: ${err.message?.slice(0, 40) || 'Unknown error'}`);
    } finally {
      setCancellingSubId(null);
    }
  };

  if (!mounted) return null;

  if (view === 'selection') {
    return (
      <div className="min-h-screen bg-white text-[#1A1F36] flex flex-col items-center justify-center p-6 font-sans antialiased">
        <div className="max-w-4xl w-full">
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-2">
              <img src="/recurve-logo.png" alt="Recurve" className="w-10 h-10 rounded-lg" />
              <span className="text-xl font-bold tracking-tight">Recurve</span>
            </div>
            {authenticated && (
              <button
                onClick={() => setView('portal')}
                className="text-sm font-bold text-[#004D40] hover:bg-gray-50 px-4 py-2 rounded-lg transition-all"
              >
                My Subscriptions ({subscriptions.filter(s => s.active).length})
              </button>
            )}
          </div>

          <h1 className="text-4xl font-extrabold text-center mb-4">Choose your plan</h1>
          <p className="text-center text-gray-500 mb-12 text-lg">Seamless on-chain recurring payments.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tiers.map((tier) => {
              const isCurrent = activeSub?.tierId === BigInt(tier.id);
              return (
                <div
                  key={tier.id}
                  onClick={() => { if (!isCurrent) { setSelectedTier(tier); setView('checkout'); } }}
                  className={`group border border-gray-100 p-8 rounded-2xl transition-all bg-white ${isCurrent
                    ? 'cursor-default opacity-80'
                    : 'cursor-pointer hover:shadow-[0_20px_40px_rgba(0,0,0,0.05)] hover:border-[#004D40]/20'
                    }`}
                >
                  <h3 className="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4">
                    {tier.name}
                    {activeSub?.tierId === BigInt(tier.id) && (
                      <span className="ml-2 text-[10px] bg-[#004D40] text-white px-2 py-0.5 rounded-full">CURRENT</span>
                    )}
                  </h3>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-3xl font-extrabold">${tier.amount}</span>
                    <span className="text-gray-400 font-medium">/ month</span>
                  </div>
                  <p className="text-gray-500 text-sm mb-6 leading-relaxed">{tier.desc}</p>
                  <div className={`flex items-center font-bold text-sm gap-1 group-hover:gap-2 transition-all ${activeSub?.tierId === BigInt(tier.id) ? 'text-gray-300' : 'text-[#004D40]'
                    }`}>
                    {activeSub ? (
                      activeSub.tierId === BigInt(tier.id) ? 'Current Plan' : (activeSub.tierId < BigInt(tier.id) ? 'Upgrade' : 'Downgrade')
                    ) : 'Select'}
                    {activeSub?.tierId !== BigInt(tier.id) && <ChevronRight className="w-4 h-4" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (view === 'checkout') {
    return (
      <div className="min-h-screen bg-white flex flex-col md:flex-row font-sans text-[#1A1F36] antialiased">
        {/* Left Column - Summary */}
        <div className="w-full md:w-[45%] bg-[#F7F8F9] p-4 sm:p-6 md:p-24 flex flex-col justify-between">
          <div>
            <button
              onClick={() => setView('selection')}
              className="flex items-center gap-2 text-gray-500 hover:text-black mb-6 md:mb-12 transition-colors font-medium text-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Back to plans
            </button>

            <div className="flex items-center gap-2 mb-4 md:mb-8">
              <img src="/recurve-logo.png" alt="Recurve" className="w-6 h-6 sm:w-8 sm:h-8 rounded" />
              <span className="font-bold tracking-tight">Recurve</span>
            </div>

            <h2 className="text-gray-500 font-medium mb-2 uppercase text-xs tracking-widest">
              {activeSub
                ? (selectedTier.id > Number(activeSub.tierId) ? 'Upgrade to ' : 'Downgrade to ') + selectedTier.name
                : `Subscribe to ${selectedTier.name}`
              }
            </h2>
            <div className="flex items-baseline gap-1 mb-4 md:mb-8">
              <span className="text-3xl sm:text-4xl md:text-5xl font-extrabold">${selectedTier.amount}.00</span>
              <span className="text-gray-400 text-base sm:text-lg md:text-xl font-medium">per month</span>
            </div>

            <div className="space-y-4 pt-8 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <span className="font-medium text-black">{selectedTier.name} Plan</span>
                <span className="text-gray-500">${selectedTier.amount}.00</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">Network Fee (Arc)</span>
                <span className="text-gray-500 italic">Sponsored by Paymaster</span>
              </div>
              <div className="flex justify-between items-center pt-4 border-t border-gray-200 text-lg font-bold">
                <span>Total due today</span>
                <span>${selectedTier.amount}.00</span>
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 text-gray-400 text-xs font-medium">
            <Lock className="w-3 h-3" /> Powered by Arc Network Account Abstraction
          </div>
        </div>

        {/* Right Column - Payment */}
        <div className="w-full md:w-[55%] p-4 sm:p-6 md:p-24 flex flex-col justify-center">
          <div className="max-w-md w-full mx-auto">
            <h3 className="text-xl md:text-2xl font-bold mb-6 md:mb-8 pt-4 md:pt-0">Pay with Arc Wallet</h3>

            {!authenticated ? (
              <button
                onClick={login}
                className="w-full py-4 bg-[#004D40] text-white rounded-lg font-bold hover:shadow-lg transition-all flex items-center justify-center gap-2 mb-4"
              >
                Sign In to Pay
              </button>
            ) : (
              <div className="space-y-6">
                <div className="p-3 sm:p-4 md:p-6 bg-[#F7F8F9] rounded-xl border border-gray-100">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xs font-bold uppercase tracking-widest text-[#004D40]">Primary Wallet (EOA)</span>
                    <button onClick={logout} className="text-xs text-red-500 font-bold hover:underline">Sign out</button>
                  </div>
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-400 font-mono">{formatAddress(eoaWallet?.address || '')}</p>
                      <button
                        onClick={() => eoaWallet && copyToClipboard(eoaWallet.address)}
                        className="text-gray-400 hover:text-[#004D40] transition-colors"
                      >
                        {copiedAddress === eoaWallet?.address ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <span className="text-sm font-bold text-slate-900">{parseFloat(eoaUsdcBalance).toFixed(2)} USDC</span>
                  </div>

                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold uppercase tracking-widest text-[#004D40]">Subscription Vault (Smart Account)</span>
                      {smartWalletAddress && <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
                    </div>

                    {!smartWalletAddress ? (
                      <div className="p-4 bg-[#004D40]/5 rounded-lg border border-dashed border-[#004D40]/20 text-center">
                        <p className="text-xs text-gray-500 mb-3 font-medium">No Subscription Vault detected for this account.</p>
                        <button
                          onClick={async () => {
                            try {
                              setStatus('Creating Subscription Vault...');
                              setLoading(true);
                              // This creates an embedded wallet which triggers smart wallet creation
                              await login();
                            } catch (e: any) {
                              console.error('Vault creation error:', e);
                              setStatus('Failed to create vault. Try again.');
                            } finally {
                              setLoading(false);
                            }
                          }}
                          disabled={loading}
                          className="px-4 py-2 bg-white border border-[#004D40] text-[#004D40] text-xs font-bold rounded-lg hover:bg-[#004D40]/5 transition-all disabled:opacity-50"
                        >
                          Create Subscription Vault
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <p className="text-xs text-gray-400 font-mono text-ellipsis overflow-hidden">
                              {formatAddress(smartWalletAddress)}
                            </p>
                            <button
                              onClick={() => copyToClipboard(smartWalletAddress)}
                              className="text-gray-300 hover:text-[#004D40] transition-colors flex-shrink-0"
                            >
                              {copiedAddress === smartWalletAddress ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                          <span className="text-sm font-bold text-slate-900 flex-shrink-0">{parseFloat(smartUsdcBalance).toFixed(2)} USDC</span>
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="number"
                            placeholder="Amount..."
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                            className="flex-1 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#004D40]"
                          />
                          <button
                            onClick={handleDeposit}
                            disabled={loading || !depositAmount}
                            className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-lg transition-all disabled:opacity-50"
                          >
                            {loading && status.includes('Vault') ? 'Funding...' : 'Top Up'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {status && (
                  <div className="text-sm font-medium text-[#004D40] flex items-center gap-2 animate-pulse p-2 bg-[#004D40]/5 rounded-lg">
                    <Loader2 className="w-4 h-4 animate-spin" /> {status}
                  </div>
                )}

                <button
                  onClick={handleSubscribe}
                  disabled={loading || (!!smartWalletAddress && parseFloat(smartUsdcBalance) < parseFloat(selectedTier.amount))}
                  className="w-full py-4 bg-[#004D40] text-white rounded-lg font-bold hover:shadow-lg transition-all disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2"
                >
                  {loading && !status.includes('Vault') ? 'Activating...' :
                    (!smartWalletAddress ? 'Create Vault First' : `Subscribe for $${selectedTier.amount}.00`)}
                </button>


              </div>
            )}

            <p className="mt-8 text-center text-gray-400 text-xs">
              By confirming, you authorize Recurve to charge this wallet on a recurring basis until you cancel.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'success') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6 font-sans antialiased text-[#1A1F36]">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-8 animate-bounce">
            <CheckCircle className="text-green-500 w-10 h-10" />
          </div>
          <h1 className="text-4xl font-extrabold mb-4">Payment Successful</h1>
          <p className="text-gray-500 mb-12 text-lg">
            You are now subscribed to the <strong>{selectedTier.name}</strong> plan.
            Your next billing date is {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString()}.
          </p>
          <button
            onClick={() => setView('portal')}
            className="w-full py-4 bg-[#004D40] text-white rounded-lg font-bold hover:shadow-lg transition-all"
          >
            Go to Portal
          </button>
        </div>
      </div>
    );
  }

  if (view === 'portal') {
    const activeSubscription = subscriptions.find(s => s.active);
    const pastSubscriptions = subscriptions.filter(s => !s.active);

    const getNextBillingDate = (lastPaid: bigint, frequency: number) => {
      if (lastPaid === BigInt(0)) return 'Pending';
      const next = new Date((Number(lastPaid) + frequency) * 1000);
      return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const getDaysUntilRenewal = (lastPaid: bigint, frequency: number) => {
      if (lastPaid === BigInt(0)) return 0;
      const next = (Number(lastPaid) + frequency) * 1000;
      const now = Date.now();
      return Math.max(0, Math.ceil((next - now) / (1000 * 60 * 60 * 24)));
    };

    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-900 font-sans antialiased">
        {/* Header */}
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-4xl mx-auto px-6 py-4">
            <button
              onClick={() => setView('selection')}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-6 py-10">
          {/* Active Subscription Hero */}
          {activeSubscription && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-8">
              <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-8 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold rounded-full uppercase tracking-wider">Active</span>
                    </div>
                    <h2 className="text-2xl font-bold mb-1">{tiers[Number(activeSubscription.tierId)]?.name}</h2>
                    <p className="text-slate-400 text-sm">Auto-renews every month</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold">${tiers[Number(activeSubscription.tierId)]?.amount}</p>
                    <p className="text-slate-400 text-sm">per month</p>
                  </div>
                </div>
              </div>

              <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6 border-b border-slate-100">
                <div>
                  <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider font-medium">Next billing</p>
                  <p className="font-semibold">{getNextBillingDate(activeSubscription.lastPaid, 600)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider font-medium">Renews in</p>
                  <p className="font-semibold">{getDaysUntilRenewal(activeSubscription.lastPaid, 600)} days</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider font-medium">Started</p>
                  <p className="font-semibold">{new Date(Number(activeSubscription.lastPaid) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1 uppercase tracking-wider font-medium">Payment</p>
                  <p className="font-semibold flex items-center gap-1">
                    <span className="w-4 h-4 bg-blue-500 rounded-full text-white text-[8px] flex items-center justify-center font-bold">$</span>
                    USDC
                  </p>
                </div>
              </div>

              <div className="p-4 sm:p-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button
                  onClick={() => setView('selection')}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition-all"
                >
                  Change Plan
                </button>
                <button
                  onClick={() => handleCancel(activeSubscription.subId)}
                  disabled={!!cancellingSubId}
                  className="px-5 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {cancellingSubId === activeSubscription.subId ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling...</>
                  ) : (
                    'Cancel Subscription'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* No Active Sub */}
          {!activeSubscription && subscriptions.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center mb-8">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-8 h-8 text-slate-400" />
              </div>
              <h3 className="font-semibold text-lg mb-2">No active subscription</h3>
              <p className="text-slate-500 text-sm mb-6">Get started by choosing a plan that works for you.</p>
              <button
                onClick={() => setView('selection')}
                className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg transition-all"
              >
                Browse Plans
              </button>
            </div>
          )}

          {/* Payment History */}
          {subscriptions.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="font-semibold">Billing History</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {subscriptions.map((sub, idx) => (
                  <div key={idx} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${sub.active ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                        <CreditCard className={`w-5 h-5 ${sub.active ? 'text-emerald-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{tiers[Number(sub.tierId)]?.name}</p>
                          <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${sub.active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                            }`}>
                            {sub.active ? 'ACTIVE' : 'ENDED'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">
                          {sub.lastPaid === BigInt(0)
                            ? 'Pending activation'
                            : new Date(Number(sub.lastPaid) * 1000).toLocaleDateString('en-US', {
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          }
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">${tiers[Number(sub.tierId)]?.amount}.00</p>
                      <p className="text-xs text-slate-400">USDC</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  return null;
}

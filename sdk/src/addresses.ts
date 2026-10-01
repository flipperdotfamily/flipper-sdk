import type { FlipperAddresses } from "./types";
import { ROBINHOOD_CHAIN_ID } from "./constants";

/**
 * Default addresses by chain id: `resolveDeployment` uses them without fetching the manifest. Robinhood Chain's are
 * written from the deployment manifest at release (`contracts/script/pin-sdk.py`); for other chains, pass `addresses`
 * explicitly or register them once with `registerFlipperAddresses`.
 */
export const FLIPPER_ADDRESSES: Record<number, FlipperAddresses> = {
  [ROBINHOOD_CHAIN_ID]: {
    house: "0x0a85400AEd34C6392e234A979A692d464E108222",
    lens: "0x1d31c16614b74cEEC22CD956e8505A55326E01e0",
    flipper: "0x480dd0ee3B2B384bEAc0679dBfc347f7059DeBc6",
    rewardToken: "0x39dBED3a2bd333467115dE45665cC57F813C4571",
    rewards: "0x480dd0ee3B2B384bEAc0679dBfc347f7059DeBc6",
    v4Adapter: "0x0A09BB8138F5e58F4A907D3D5F15319cc1559c63",
    v3Adapter: "0xA91E9A742DF8bEA8d02628991d47800eF587b33b",
    v3Bridge: "0xD083414a0612b380ebe25f971C5aa247d6E86888",
    weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
    router: "0x693efB9A73c2F4Eafb19A524F8ae5120f32fC1f8",
    vault: "0xaA170B33f92dA17F7DAA970f372787BCa5eD6c1F",
    partnerRegistry: "0x6e23965023970113d23bFBe890E6ab918De10876",
    houseModule: "0xAa27C1797CB71cBE86e5966452308cAC67c9fAff",
    ponsVerifier: "0x0d48D8fCE729B703e4bf289f591A76470C3bfE31",
    stockVerifier: "0x44D3F1bAf6Bdc93692cfdad194CdC2c77f73401F",
    auctionConverter: "0x9539d774Bce45E880e963267144d2699D0A0B402",
    wethWrapperHook: "0x19B9350D24798c13167619CDeb92b9B4b9692888",
    principalLock: "0x362932e343469ccF9d91A989a8038eca783f174B",
  },
};

export function registerFlipperAddresses(chainId: number, addresses: FlipperAddresses): void {
  FLIPPER_ADDRESSES[chainId] = addresses;
}

export function getFlipperAddresses(chainId: number | undefined): FlipperAddresses | undefined {
  return chainId === undefined ? undefined : FLIPPER_ADDRESSES[chainId];
}

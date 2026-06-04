// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeRapide from 'starlight-theme-rapide'
import starlightSidebarTopics from 'starlight-sidebar-topics';

// https://astro.build/config
export default defineConfig({
	site: 'https://ckb-firewall.drreamer.digital',
	integrations: [
		starlight({
			title: 'CKB Transaction Firewall',
			description: 'Documentation for the CKB Transaction Firewall contracts, SDKs, CLI, and governance process.',
			favicon: '/favicon.ico',
			head: [
				{
					tag: 'link',
					attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
				},
				{
					tag: 'link',
					attrs: { rel: 'stylesheet', href: '/preview.css' },
				},
				{
					tag: 'script',
					attrs: { src: '/preview.js', defer: true },
				},
			],
			logo: {
				src: '../assets/logo.png',
				alt: 'CKB Transaction Firewall',
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/digitaldrreamer/ckb-transaction-firewall' },
			],
			editLink: {
				baseUrl: 'https://github.com/digitaldrreamer/ckb-transaction-firewall/edit/main/docs/src/content/docs/',
			},
			plugins: [
				starlightThemeRapide(),
				starlightSidebarTopics([
					{
						id: 'get-started',
						label: 'Get started',
						link: '/get-started/',
						icon: 'rocket',
						items: [
							{
								label: 'Integration developer',
								items: [
									'get-started/integration',
									'get-started/integration/1-install',
									'get-started/integration/2-fetch-registry',
									'get-started/integration/3-check-transaction',
									'get-started/integration/4-handle-errors',
									'get-started/integration/5-what-next',
								],
							},
							{
								label: 'Governance validator',
								items: [
									'get-started/validator',
									'get-started/validator/1-install-cli',
									'get-started/validator/2-import-proposal',
									'get-started/validator/3-review-proposal',
									'get-started/validator/4-vote',
									'get-started/validator/5-share-and-execute',
								],
							},
							{
								label: 'Registry operator',
								items: [
									'get-started/operator',
									'get-started/operator/1-deploy-contracts',
									'get-started/operator/2-bootstrap-registry',
									'get-started/operator/3-deploy-treasury',
									'get-started/operator/4-first-governance-round',
									'get-started/operator/5-configure-firewall-lock',
								],
							},
						],
					},
					{
						id: 'how-to',
						label: 'How-to guides',
						link: '/how-to/',
						icon: 'list-format',
						items: [
							{
								label: 'SDK — pre-flight',
								items: [
									'how-to/preflight-typescript',
									'how-to/preflight-rust',
									'how-to/single-address-check',
									'how-to/recover-stale-registry',
									'how-to/time-based-entries',
								],
							},
							{
								label: 'SDK — wallet and lock',
								items: [
									'how-to/build-firewall-lock-script',
									'how-to/build-spend-cell-deps',
									'how-to/multi-registry-lock',
								],
							},
							{
								label: 'Governance — proposals',
								items: [
									'how-to/create-proposal',
									'how-to/anchor-proposal',
									'how-to/vote-on-proposal',
									'how-to/share-proposals',
									'how-to/execute-proposal',
									'how-to/reclaim-anchor',
									'how-to/rotate-validators',
									'how-to/join-governance',
								],
							},
							{
								label: 'Governance — inspection',
								items: [
									'how-to/inspect-registry',
									'how-to/check-proposal-status',
									'how-to/use-governance-gui',
								],
							},
							{
								label: 'Operations',
								items: [
									'how-to/deploy-private-registry',
									'how-to/deploy-treasury',
									'how-to/donate-treasury',
									'how-to/prune-expired-entries',
								],
							},
							{
								label: 'Troubleshooting',
								items: [
									'how-to/troubleshoot',
									'how-to/fix-missing-registry-dep',
									'how-to/fix-ambiguous-registry-dep',
									'how-to/fix-stale-registry-cell',
									'how-to/fix-in-flight-failure',
									'how-to/fix-vote-digest-mismatch',
									'how-to/fix-preflight-passes-onchain-fails',
								],
							},
						],
					},
					{
						id: 'examples',
						label: 'Examples',
						link: '/examples/',
						icon: 'puzzle',
						items: [
							'examples/wallet-feedback',
							'examples/wallet-ui',
							'examples/blacklisted-transfer-safety',
							'examples/agent-preflight',
							'examples/preflight-service',
						],
					},
					{
						id: 'reference',
						label: 'Reference',
						link: '/reference/',
						icon: 'information',
						items: [
							{
								label: 'SDKs',
								items: [
									'reference/typescript-sdk',
									'reference/rust-sdk',
								],
							},
							{
								label: 'CLI',
								items: ['reference/cli'],
							},
							{
								label: 'Binary formats',
								items: [
									'reference/blkl-format',
									'reference/firewall-lock-args',
									'reference/gov1-witness',
									'reference/pblk-cell',
								],
							},
							{
								label: 'Contracts',
								items: [
									'reference/proposal-anchor',
									'reference/spawn-aware-secp256k1',
									'reference/error-codes',
								],
							},
							'reference/stability',
							'reference/testnet-deployment',
							'reference/glossary',
						],
					},
					{
						id: 'concepts',
						label: 'Concepts',
						link: '/concepts/',
						icon: 'open-book',
						items: [
							'concepts/ckb-background',
							'concepts/why-this-exists',
							'concepts/two-layer-model',
							'concepts/governance-design',
							'concepts/registry-design',
							'concepts/treasury-design',
							'concepts/security-model',
							'concepts/before-you-adopt',
							'concepts/trust-model-and-guarantees',
						],
					},
				], {
					exclude: ['/changelog', '/security'],
				}),
			],
		}),
	],
});

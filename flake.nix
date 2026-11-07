{
  description = "phone-agent: in-browser Pi agent hosted on a headless Pixel 6";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true; # android-tools pulls nothing unfree, but keep the door open
        };
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22   # Node LTS
            pnpm
            android-tools # adb
            tailscale     # tailscale CLI (talks to the host tailscaled)
            jq
            curl
            go_1_27       # builds vendor/tailscale-web main.wasm (GOOS=js GOARCH=wasm)
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            # load secrets (git-ignored) if present
            if [ -f .env ]; then set -a; . ./.env; set +a; fi
            echo "phone-agent dev shell: node $(node --version), pnpm $(pnpm --version)"
          '';
        };
      });
}

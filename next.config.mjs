/** @type {import('next').NextConfig} */
const nextConfig = {
  // The floating dev badge sits exactly on the mobile record button.
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig

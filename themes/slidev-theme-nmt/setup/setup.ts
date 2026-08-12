import { defineAppSetup } from '@slidev/types'

export default defineAppSetup(({ app }) => {
    async function approvedCover(category?: string) {
        const res = await fetch(
            'https://adygcode.github.io/slidev-covers-nmtafe/index.json'
        )
        const manifest = await res.json()
        const categories = Object.keys(manifest)

        const pick = <T>(arr: T[]) =>
            arr[Math.floor(Math.random() * arr.length)]

        const cat =
            category && manifest[category]
                ? category
                : pick(categories)

        return pick(manifest[cat])
    }

    app.provide('approvedCover', approvedCover)
})
